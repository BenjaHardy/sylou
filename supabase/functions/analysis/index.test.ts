// analysis/index.test.ts — the analysis handler over HTTP: CORS, the guard
// sequence (token → request check → project visibility → profile → model →
// key → writing → budget estimate), the model a FLOW analysis runs on, the
// clients that read the evidence and store the report, the retry and the
// billing of failed attempts, and the report's score integrity.
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DEFAULT_FLOW_MODEL } from "../_shared/_models.ts";
import {
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeEnv,
  fakeProvider,
  importHandler,
  jsonReply,
  LOCAL_ENV,
  LOCAL_MODEL,
  post,
  preflight,
  TEST_ORIGIN,
  UNLISTED_MODEL,
  writes,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const MODEL = "mistral-small-2603";
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const WRITING = "<p>The tide came in over the flats.</p>";
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };

interface World {
  /** Profile overrides; null = no profile row. */
  profile?: Record<string, unknown> | null;
  /** false = RLS hides the project from the caller. */
  project?: boolean;
  /** The saved writing; WRITING unless given. */
  writing?: string;
  /** Chat messages in the project's thread t-1. */
  messages?: Record<string, unknown>[];
  /** The flow_reports insert fails. */
  failReportInsert?: boolean;
}

/** User u-1's general project with one paragraph of writing and no budget
 *  cap; no chat, provenance, editor activity or documents unless given. */
function world(w: World) {
  return (call: DbCall): DbResult | undefined => {
    switch (`${call.client} ${call.target}`) {
      case "user projects":
        return w.project === false ? NO_ROW : {
          data: { id: PROJECT_ID, language: "English", tutor_mode: false, name: "Estuary", template: "general" },
          error: null,
        };
      case "user profiles":
        return w.profile === null ? NO_ROW : {
          data: { tokens_used_this_period: 0, monthly_token_budget: null, preferred_flow_model: MODEL, ...w.profile },
          error: null,
        };
      case "user writing_content":
        return { data: { content: w.writing ?? WRITING }, error: null };
      case "user chat_threads":
        return { data: w.messages ? [{ id: "t-1", name: "Main" }] : [], error: null };
      case "user chat_messages":
        return { data: w.messages ?? [], error: null };
      case "admin flow_reports": {
        if (w.failReportInsert) return { data: null, error: { message: "insert denied" } };
        const values = call.steps[0][1] as Record<string, unknown>;
        return { data: { id: "r-1", ...values }, error: null };
      }
    }
    return undefined;
  };
}

async function send(
  req: Request,
  opts: World & {
    user?: { id: string } | null;
    replies?: Response[];
    env?: Record<string, string | undefined>;
  } = {},
) {
  const backend = fakeBackend({
    user: opts.user === undefined ? { id: "u-1" } : opts.user,
    respond: world(opts),
  });
  const provider = fakeProvider(...(opts.replies ?? []));
  const res = await handler(req, {
    env: fakeEnv(opts.env),
    createClient: backend.createClient,
    callLLM: provider.callLLM,
  });
  return { res, backend, provider };
}

const clientsBuilt = (backend: ReturnType<typeof fakeBackend>) => backend.created.map((c) => c.client);

const ANALYSE = { project_id: PROJECT_ID };

const pillar = (score: unknown) => ({
  reasoning: "Grounded in the drafts.",
  evidence: ["The first draft."],
  score,
  narrative: "Steady work.",
});

/** A complete FLOW answer, as the report tool returns it. */
const FLOW_RESULT = {
  summary: "A short piece, written by its author.",
  find: pillar(3.5),
  lead: pillar(3),
  organize: pillar(4),
  write: pillar(4.5),
  key_user_contributions: [
    { contribution: "The opening line.", evidence: "Typed in the first draft.", why_it_matters: "It sets the scene." },
  ],
};

/** The model's answer through the forced report tool (Mistral shape). */
const flowReply = (args: Record<string, unknown>) =>
  jsonReply({ toolCalls: [{ id: "call-1", name: "submit_flow_analysis", arguments: args }] });

/** The report row the handler stored. */
const storedReport = (backend: ReturnType<typeof fakeBackend>) =>
  writes(backend.calls).find(([, table]) => table === "flow_reports")?.[2] as Record<string, unknown>;

/** The assistant reply the writing repeats word for word. */
const ECHOED_REPLY = {
  created_at: "2026-11-01T10:00:00Z",
  role: "assistant",
  content: "The tide came in over the flats.",
  source_type: "chat",
  flow_flag: "normal",
  thread_id: "t-1",
};

// Both attempts fail at the provider, so the request ends with a 502 and a
// usage row per failed attempt (the provider charges for those too).
const twoFailedAttempts = () => [
  Response.json({ message: "Overloaded" }, { status: 503 }),
  Response.json({ message: "Overloaded" }, { status: 503 }),
];

const usageModels = (backend: ReturnType<typeof fakeBackend>) =>
  writes(backend.calls)
    .filter(([, table]) => table === "token_usage")
    .map(([, , values]) => (values as { model_used?: string }).model_used);

// ── CORS ─────────────────────────────────────────────────────────────────

Deno.test("preflight from the allowed origin: CORS headers, and no client is built", async () => {
  const { res, backend } = await send(preflight());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(backend.created, []);
});

Deno.test("an origin off the allow-list gets no Access-Control-Allow-Origin", async () => {
  const { res } = await send(preflight("https://elsewhere.test"));
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(res.headers.get("Vary"), "Origin");
});

// ── The guard sequence ───────────────────────────────────────────────────

Deno.test("no bearer token: 401 before any client is built", async () => {
  for (const authorization of [null, "Basic dXNlcjpwYXNz"]) {
    const { res, backend } = await send(post(ANALYSE, { authorization }));
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "Missing authorization" });
    assertEquals(backend.created, []);
  }
});

Deno.test("a token Supabase Auth rejects: 401; only the user-scoped client exists, carrying that token", async () => {
  const { res, backend, provider } = await send(post(ANALYSE), { user: null });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(backend.created, [{ client: "user", authorization: "Bearer user-jwt" }]);
  assertEquals(backend.calls.map((c) => `${c.client} ${c.target}`), ["user auth:getUser"]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("a project id that is not a UUID: 400 before any table is read", async () => {
  for (const project_id of [undefined, "p-1", 42, "00000000-0000-4000-8000-00000000000g"]) {
    const { res, backend } = await send(post({ project_id }));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "project_id must be a valid UUID" });
    assertEquals(backend.calls.map((c) => c.target), ["auth:getUser"]);
  }
});

Deno.test("a project RLS hides from the caller: 404 from the user-scoped read, before any service-role client", async () => {
  const { res, backend, provider } = await send(post(ANALYSE), { project: false });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Project not found or not owned by user" });
  assertEquals(backend.calls.find((c) => c.target === "projects")?.client, "user");
  assertEquals(clientsBuilt(backend), ["user"]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("no profile row: 404", async () => {
  const { res, backend } = await send(post(ANALYSE), { profile: null });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Profile not found" });
  assertEquals(clientsBuilt(backend), ["user"]);
});

Deno.test("the model's provider key is not configured: 500 before any provider call", async () => {
  const { res, provider } = await send(post(ANALYSE), { env: { MISTRAL_API_KEY: undefined } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "mistral API key not configured" });
  assertEquals(provider.calls.length, 0);
});

Deno.test("no writing to analyse: 400 before a provider call or the service-role client", async () => {
  for (const writing of ["", "   "]) {
    const { res, backend, provider } = await send(post(ANALYSE), { writing });
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "No writing to analyze" });
    assertEquals(provider.calls.length, 0);
    assertEquals(clientsBuilt(backend), ["user"]);
  }
});

Deno.test("a budget too small for the estimate: 403 with the estimate, before a provider call or the service-role client", async () => {
  const { res, backend, provider } = await send(post(ANALYSE), {
    profile: { monthly_token_budget: 1_000, tokens_used_this_period: 900 },
  });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals([body.error, body.budget_remaining], ["Insufficient token budget for FLOW analysis", 100]);
  assert(typeof body.estimated_cost === "number" && body.estimated_cost > 100);
  assertEquals(provider.calls.length, 0);
  assertEquals(clientsBuilt(backend), ["user"]);
});

// ── The model ────────────────────────────────────────────────────────────

Deno.test("both attempts run on the saved FLOW model when it is listed, and the usage rows name it", async () => {
  const { res, backend, provider } = await send(post({ project_id: PROJECT_ID }), { replies: twoFailedAttempts() });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Overloaded" });
  assertEquals(provider.calls.map((c) => c.model), [MODEL, MODEL]);
  assertEquals(usageModels(backend), [MODEL, MODEL]);
});

Deno.test("a saved FLOW model off the allowlist: both attempts run on the default model, and the usage rows name it", async () => {
  const { res, backend, provider } = await send(post({ project_id: PROJECT_ID }), {
    profile: { preferred_flow_model: UNLISTED_MODEL },
    env: { ANTHROPIC_API_KEY: "anthropic-key" },
    replies: twoFailedAttempts(),
  });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Overloaded" });
  assertEquals(provider.calls.map((c) => c.model), [DEFAULT_FLOW_MODEL, DEFAULT_FLOW_MODEL]);
  assertEquals(usageModels(backend), [DEFAULT_FLOW_MODEL, DEFAULT_FLOW_MODEL]);
});

Deno.test("an unlisted requested model: 400 before the writing is read or a provider called", async () => {
  const { res, backend, provider } = await send(post({ project_id: PROJECT_ID, model: "gpt-9" }));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Unsupported model: gpt-9" });
  assertEquals(backend.calls.some((c) => c.target === "writing_content"), false);
  assertEquals(provider.calls.length, 0);
});

// ── The report ───────────────────────────────────────────────────────────

Deno.test("a FLOW run: one forced report-tool call, the report stored by the service-role client, billed to the caller", async () => {
  const { res, backend, provider } = await send(post(ANALYSE), {
    env: {
      SYLOU_INSTANCE_LABEL: "staging",
      SYLOU_INSTANCE_DOMAIN: "sylou.test",
      SYLOU_VERSION: "0.7.0",
      SYLOU_COMMIT_HASH: "abc1234",
    },
    replies: [flowReply(FLOW_RESULT)],
  });
  assertEquals(res.status, 200);
  const body = await res.json();

  assertEquals(provider.calls.length, 1);
  assertEquals(provider.calls[0].forceTool, "submit_flow_analysis");

  // The report: this project, the model that ran, the operator's generator
  // info, and no user id (a report reaches its owner through the project).
  const [report, usage, ...more] = writes(backend.calls);
  assertEquals(more, []);
  assertEquals(report.slice(0, 2), ["admin", "flow_reports"]);
  const row = report[2] as Record<string, unknown>;
  assertEquals(
    [row.project_id, row.model_used, row.project_name, row.writing_snapshot, row.ai_summary, row.ai_write],
    [PROJECT_ID, MODEL, "Estuary", WRITING, FLOW_RESULT.summary, FLOW_RESULT.write],
  );
  assertEquals(row.generator_info, {
    instance_label: "staging",
    instance_domain: "sylou.test",
    version: "0.7.0",
    commit_hash: "abc1234",
    is_modified: false,
  });
  assert(!("user_id" in row));
  assertEquals(body.report, { id: "r-1", ...row });

  // The usage row through the caller's client; the budget counter through the service role.
  assertEquals(usage.slice(0, 2), ["user", "token_usage"]);
  const { input_tokens, output_tokens, ...usageRow } = usage[2] as Record<string, unknown>;
  assertEquals(usageRow, { user_id: "u-1", project_id: PROJECT_ID, function_name: "analysis", model_used: MODEL });
  assertEquals(body.tokens_used, Number(input_tokens) + Number(output_tokens));
  const billing = backend.calls.find((c) => c.target === "rpc:increment_tokens_used");
  assertEquals(billing?.client, "admin");
  assertEquals(billing?.steps[0][1], { user_uuid: "u-1", amount: body.tokens_used });
  assertEquals(body.budget_remaining, null);
});

Deno.test("every read goes through the caller's client, and the run never touches the writing summary log or the conversation memory", async () => {
  const { res, backend } = await send(post(ANALYSE), { messages: [ECHOED_REPLY], replies: [flowReply(FLOW_RESULT)] });
  assertEquals(res.status, 200);
  const targets = (client: string) =>
    [...new Set(backend.calls.filter((c) => c.client === client).map((c) => c.target))].sort();
  assertEquals(targets("user"), [
    "ai_editor_actions",
    "auth:getUser",
    "chat_messages",
    "chat_threads",
    "imported_documents",
    "profiles",
    "project_stats",
    "projects",
    "provenance_events",
    "rpc:reset_tokens_if_stale",
    "token_usage",
    "writing_content",
    "writing_versions",
  ]);
  // Both lists are complete, so neither summary table is among them. (The
  // tables' names stay out of this file: _flow_isolation.test.ts greps the
  // analysis directory for the memory table's.)
  assertEquals(targets("admin"), ["flow_reports", "rpc:increment_tokens_used"]);
});

Deno.test("a budget with room: the response reports what is left after this run", async () => {
  const { res } = await send(post(ANALYSE), {
    profile: { monthly_token_budget: 10_000_000, tokens_used_this_period: 1_000 },
    replies: [flowReply(FLOW_RESULT)],
  });
  const body = await res.json();
  assertEquals(body.budget_remaining, 10_000_000 - 1_000 - body.tokens_used);
});

Deno.test("an invalid first answer is retried once with a nudge; the report is stored and the failed attempt billed", async () => {
  const { res, backend, provider } = await send(post(ANALYSE), {
    replies: [flowReply({ summary: "Incomplete." }), flowReply(FLOW_RESULT)],
  });
  assertEquals(res.status, 200);
  assertEquals(provider.calls.length, 2);
  const nudge = String(provider.calls[1].messages.at(-1)?.content);
  assert(nudge.endsWith("is returned as a nested JSON object, not as a stringified JSON value."));
  const written = writes(backend.calls).map(([client, table, values]) =>
    [client, table, (values as { function_name?: string }).function_name ?? null]
  );
  assertEquals(written, [
    ["user", "token_usage", "analysis:schema_invalid"],
    ["admin", "flow_reports", null],
    ["user", "token_usage", "analysis"],
  ]);
  assertEquals(backend.calls.filter((c) => c.target === "rpc:increment_tokens_used").map((c) => c.client), ["admin", "admin"]);
});

Deno.test("an answer cut off at the output limit: no retry, 502, and the attempt billed as analysis:max_tokens", async () => {
  const cutOff = Response.json({ choices: [{ message: { role: "assistant", content: "" }, finish_reason: "length" }] });
  const { res, backend, provider } = await send(post(ANALYSE), { replies: [cutOff] });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Analysis output was truncated. Please try again or use a smaller project." });
  assertEquals(provider.calls.length, 1);
  assertEquals(writes(backend.calls).map(([client, table, values]) => [client, table, (values as { function_name: string }).function_name]), [
    ["user", "token_usage", "analysis:max_tokens"],
  ]);
});

Deno.test("a report that cannot be stored: 500, and the run is not billed as a success", async () => {
  const { res, backend } = await send(post(ANALYSE), { failReportInsert: true, replies: [flowReply(FLOW_RESULT)] });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Failed to store analysis report" });
  assertEquals(writes(backend.calls).map(([client, table]) => `${client} ${table}`), ["admin flow_reports"]);
  assertEquals(backend.calls.some((c) => c.target === "rpc:increment_tokens_used"), false);
});

// ── Score integrity ──────────────────────────────────────────────────────

Deno.test("scores: a number sent as text is stored as a number, an out-of-range one is emptied, and both are disclosed", async () => {
  const { backend } = await send(post(ANALYSE), {
    replies: [flowReply({ ...FLOW_RESULT, lead: pillar(7), write: pillar("4.5") })],
  });
  const row = storedReport(backend);
  assertEquals([(row.ai_lead as { score: unknown }).score, (row.ai_write as { score: unknown }).score], [null, 4.5]);
  const meta = row.flow_meta as { repaired_pillars: string[]; defaulted_sections: string[] };
  assertEquals([meta.repaired_pillars, meta.defaulted_sections], [["write.score"], ["lead.score"]]);
});

Deno.test("writing that repeats the AI's replies (35% or more): the Write score is capped at 2.0, and the cap disclosed", async () => {
  const { backend, provider } = await send(post(ANALYSE), {
    messages: [ECHOED_REPLY],
    replies: [flowReply(FLOW_RESULT)],
  });
  assert(String(provider.calls[0].messages.at(-1)?.content).includes("# === WRITE PILLAR NOTICE ==="));
  const row = storedReport(backend);
  const write = row.ai_write as { score: number; narrative: string };
  assertEquals(write.score, 2.0);
  assert(write.narrative.endsWith("[Note: Write score capped at 2.0 due to automated similarity detection finding 100% overlap with AI chat responses.]"));
  const meta = row.flow_meta as { similarity_pct: number; write_score_capped: boolean };
  assertEquals([meta.similarity_pct, meta.write_score_capped], [100, true]);
});

// ── A local model (_ollama.ts) ───────────────────────────────────────────

Deno.test("a listed local model: 400, FLOW runs on cloud models only, before the writing is read", async () => {
  const { res, backend, provider } = await send(post(ANALYSE), {
    profile: { preferred_flow_model: LOCAL_MODEL },
    env: LOCAL_ENV,
  });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), {
    error: "FLOW analyses run on cloud models only. Pick a cloud model for FLOW in Settings.",
  });
  assertEquals(backend.calls.some((c) => c.target === "writing_content"), false);
  assertEquals(provider.calls.length, 0);
});
