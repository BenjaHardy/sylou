// context-prompt/index.test.ts — the context-prompt handler over HTTP: CORS,
// the guard sequence (token → profile → budget → model → key → request checks
// → project and thread visibility), the CONFIRM decision, the three ways a
// reply is produced (no tools, tools offered but unused, a document read)
// with their phase / token / done events, the rows each exchange saves and
// the client that writes them, and the error paths.
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fallbackReplyText } from "../_shared/_llm.ts";
import { DEFAULT_CHAT_MODEL, INPUT_LIMITS } from "../_shared/_models.ts";
import { estimatePromptTokens } from "../_shared/_fit.ts";
import { RESULT_CUT_NOTE } from "../_shared/_tool_loop.ts";
import {
  anthropicStreamedReply,
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeEnv,
  fakeLocalModels,
  fakeProvider,
  importHandler,
  jsonReply,
  LOCAL_ENV,
  LOCAL_MODEL,
  post,
  preflight,
  readEvents,
  streamedReply,
  TEST_ORIGIN,
  UNLISTED_MODEL,
  writes,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const MODEL = "mistral-small-2603";
const ASK = {
  project_id: "p-1",
  thread_id: "t-1",
  action_type: "ask",
  selected_text: "The tide came in.",
  instruction: "Is this sentence clear?",
  source_module: "editor",
  stream: true,
};
const PROPOSE = { ...ASK, action_type: "propose", instruction: "Make it vivid." };
const CONFIRM = { project_id: "p-1", confirm: true, action_id: "a-1" };
const SUMMARY = "The writing so far: one sentence about the tide.";
const REPLY = "It reads clearly.";
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };

interface World {
  /** Profile overrides; null = no profile row. */
  profile?: Record<string, unknown> | null;
  /** false = RLS hides project p-1 from the caller. */
  project?: boolean;
  /** The project's writing summary so far; none unless given. */
  summary?: string;
  /** Project p-1's imported documents. */
  docs?: Record<string, unknown>[];
  /** The pending-gated decision update matches no row (already decided). */
  actionDecided?: boolean;
  /** The reply's chat_messages insert fails. */
  failReplyInsert?: boolean;
  /** The project's writing (HTML); one sentence unless given. */
  writing?: string;
  /** Thread t-1's saved messages; none unless given. */
  messages?: { role: string; content: string; created_at: string }[];
}

/** Another user's favourite document, in project p-2. */
const FOREIGN_DOC = {
  id: "d-other",
  project_id: "p-2",
  file_name: "theirs.md",
  summary: "Someone else's notes",
  extracted_text: "Another user's text.",
  is_favourite: true,
};

/** A non-favourite document of p-1: listed in the prompt, readable through the tool. */
const NOTES_DOC = {
  id: "d-1",
  file_name: "notes.md",
  summary: "Field notes",
  extracted_text: "The field notes.",
  is_favourite: false,
};

/** Project p-1 and its thread t-1, visible to user u-1 (budget 10,000, 100
 *  used): writing, no summary, memory, history or documents unless given. */
function world(w: World) {
  let inserts = 0;
  // The thread's conversation memory, once a refresh wrote one.
  let memory: Record<string, unknown> | null = null;
  // The saved messages a query selects: its bounds, order and limit applied.
  const readMessages = (steps: unknown[][]) => {
    let rows = [...(w.messages ?? [])];
    for (const [step, , value] of steps) {
      if (step === "lte") rows = rows.filter((r) => r.created_at <= String(value));
      if (step === "gt") rows = rows.filter((r) => r.created_at > String(value));
    }
    const ascending = (steps.find(([step]) => step === "order")?.[2] as { ascending?: boolean })?.ascending ?? true;
    rows.sort((a, b) => a.created_at.localeCompare(b.created_at) * (ascending ? 1 : -1));
    const limit = steps.find(([step]) => step === "limit")?.[1] as number | undefined;
    return rows.slice(0, limit);
  };
  return (call: DbCall): DbResult | undefined => {
    const first = call.steps[0]?.[0];
    const last = call.steps.at(-1)?.[0];
    const eqs = call.steps.filter(([step]) => step === "eq");
    if (call.target === "chat_thread_summaries") {
      const values = call.steps[0][1] as Record<string, unknown>;
      if (first === "update" && memory) memory = { ...memory, ...values };
      if (first === "insert") memory = values;
      return first === "update" ? { data: memory ? [{ id: "s-1" }] : [], error: null } : { data: memory, error: null };
    }
    switch (`${call.client} ${call.target}`) {
      case "user profiles":
        return w.profile === null ? NO_ROW : {
          data: {
            tokens_used_this_period: 100,
            monthly_token_budget: 10_000,
            preferred_chat_model: MODEL,
            preferred_chat_reasoning: null,
            ...w.profile,
          },
          error: null,
        };
      case "user projects":
        if (w.project === false) return last === "maybeSingle" ? { data: null, error: null } : NO_ROW;
        return { data: { id: "p-1", tutor_mode: false, language: "English", template: "general" }, error: null };
      case "user chat_threads": {
        // Visible only as thread t-1 of project p-1, as RLS and the project predicate would have it.
        const visible = eqs.some(([, column, value]) => column === "id" && value === "t-1") &&
          eqs.some(([, column, value]) => column === "project_id" && value === "p-1");
        return { data: visible ? { id: "t-1" } : null, error: null };
      }
      case "user writing_content":
        return { data: { content: w.writing ?? "<p>The tide came in.</p>" }, error: null };
      case "user writing_summary_log":
        return w.summary === undefined ? NO_ROW : { data: { id: "s-1", summary_text: w.summary }, error: null };
      case "user chat_messages":
        return { data: readMessages(call.steps).map(({ role, content }) => ({ role, content })), error: null };
      case "admin imported_documents": {
        // Filtered by the eq steps the handler sends, as the database would.
        const rows = [...(w.docs ?? []).map((d) => ({ project_id: "p-1", ...d })), FOREIGN_DOC];
        const matching = rows.filter((row) =>
          eqs.every(([, column, value]) => (row as Record<string, unknown>)[String(column)] === value)
        );
        return last === "maybeSingle" ? { data: matching[0] ?? null, error: null } : { data: matching, error: null };
      }
      case "admin ai_editor_actions":
        if (first === "update") return { data: w.actionDecided ? null : { id: "a-1" }, error: null };
        return { data: { id: "a-1" }, error: null };
      case "admin chat_messages": {
        // The memory refresh's candidate read.
        if (first !== "insert") return { data: readMessages(call.steps), error: null };
        const values = call.steps[0][1] as Record<string, unknown>;
        if (w.failReplyInsert && String(values.source_type).endsWith("_response")) {
          return { data: null, error: { message: "insert denied" } };
        }
        return { data: { id: `m-${++inserts}`, ...values }, error: null };
      }
      case "admin project_stats":
        return first === "select" ? { data: { chat_prompt_count_normal: 2 }, error: null } : undefined;
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
    localModels?: ReturnType<typeof fakeLocalModels>;
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
    localModelInfo: opts.localModels?.localModelInfo,
  });
  return { res, backend, provider };
}

const clientsBuilt = (backend: ReturnType<typeof fakeBackend>) => backend.created.map((c) => c.client);

const billing = (backend: ReturnType<typeof fakeBackend>) =>
  backend.calls.find((c) => c.target === "rpc:increment_tokens_used");

/** The characters the handler sent the provider in call `i`. */
const sentChars = (provider: ReturnType<typeof fakeProvider>, i: number) =>
  provider.calls[i].messages.reduce((sum, m) => sum + String(m.content).length, 0);

const summaryReply = () => jsonReply({ content: SUMMARY });
const readDoc = (document_id = "d-1") =>
  jsonReply({ toolCalls: [{ id: "call-1", name: "read_imported_document", arguments: { document_id } }] });
const overloaded = () => Response.json({ message: "Overloaded" }, { status: 503 });

// The summary call answers and the reply call fails, so the request ends
// before a stream opens and nothing is saved.
const summaryThenFailedReply = () => [
  jsonReply({ content: "The writing so far: one sentence about the tide." }),
  Response.json({ message: "Overloaded" }, { status: 503 }),
];

const PROMPT_ROW = {
  thread_id: "t-1",
  role: "user",
  content: '[Ask] Selected: "The tide came in."\nQuestion: Is this sentence clear?',
  source_type: "ask_prompt",
  flow_flag: "normal",
  concise_mode: false,
  tutor_mode: false,
};
const SUMMARY_ROW = {
  thread_id: "t-1",
  role: "assistant",
  content: SUMMARY,
  source_type: "writing_summary",
  flow_flag: "not_assessed",
};
const REPLY_ROW = {
  thread_id: "t-1",
  role: "assistant",
  content: REPLY,
  source_type: "ask_response",
  flow_flag: "normal",
  model_used: MODEL,
  concise_mode: false,
  tutor_mode: false,
};

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
    const { res, backend } = await send(post(ASK, { authorization }));
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "Missing authorization" });
    assertEquals(backend.created, []);
  }
});

Deno.test("a token Supabase Auth rejects: 401; only the user-scoped client exists, carrying that token", async () => {
  const { res, backend, provider } = await send(post(ASK), { user: null });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(backend.created, [{ client: "user", authorization: "Bearer user-jwt" }]);
  assertEquals(backend.calls.map((c) => `${c.client} ${c.target}`), ["user auth:getUser"]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("no profile row: 404", async () => {
  const { res, backend } = await send(post(ASK), { profile: null });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Profile not found" });
  assertEquals(clientsBuilt(backend), ["user"]);
});

Deno.test("budget spent: 403 before the body is read, a provider called or the service-role client built", async () => {
  const req = post(ASK);
  const { res, backend, provider } = await send(req, { profile: { tokens_used_this_period: 10_000 } });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Monthly token budget exceeded" });
  assertEquals(req.bodyUsed, false);
  assertEquals(provider.calls.length, 0);
  assertEquals(clientsBuilt(backend), ["user"]);
});

Deno.test("the model's provider key is not configured: 500 before any provider call", async () => {
  const { res, provider } = await send(post(ASK), { env: { MISTRAL_API_KEY: undefined } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "mistral API key not configured" });
  assertEquals(provider.calls.length, 0);
});

const REJECTED: [string, Record<string, unknown>, string][] = [
  [
    "a missing instruction",
    { ...ASK, instruction: undefined },
    "project_id, thread_id, action_type, selected_text, instruction, and source_module are required",
  ],
  ["a non-streaming request", { ...ASK, stream: false }, "Only streaming requests are supported (send stream: true)"],
  [
    "an over-long selection",
    { ...ASK, selected_text: "x".repeat(INPUT_LIMITS.SELECTED_TEXT_CHARS + 1) },
    `Selection is too long (max ${INPUT_LIMITS.SELECTED_TEXT_CHARS.toLocaleString("en-US")} characters)`,
  ],
  [
    "a selection that is not text",
    { ...ASK, selected_text: 42 },
    `Selection is too long (max ${INPUT_LIMITS.SELECTED_TEXT_CHARS.toLocaleString("en-US")} characters)`,
  ],
  [
    "an over-long instruction",
    { ...ASK, instruction: "x".repeat(INPUT_LIMITS.INSTRUCTION_CHARS + 1) },
    `Instruction is too long (max ${INPUT_LIMITS.INSTRUCTION_CHARS.toLocaleString("en-US")} characters)`,
  ],
  [
    "an over-long source note",
    { ...ASK, selected_text_source: "x".repeat(INPUT_LIMITS.SHORT_FIELD_CHARS + 1) },
    "Invalid selected_text_source",
  ],
  ["an action that is neither Ask nor Propose", { ...ASK, action_type: "rewrite" }, "action_type must be 'ask' or 'propose'"],
];

for (const [what, body, error] of REJECTED) {
  Deno.test(`${what}: 400 before the project is looked up or a provider called`, async () => {
    const { res, backend, provider } = await send(post(body));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error });
    assertEquals(backend.calls.some((c) => c.target === "projects"), false);
    assertEquals(provider.calls.length, 0);
    assertEquals(clientsBuilt(backend), ["user"]);
  });
}

Deno.test("a project RLS hides from the caller: 404 from the user-scoped read, before any service-role client", async () => {
  const { res, backend, provider } = await send(post(ASK), { project: false });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Project not found or not owned by user" });
  assertEquals(backend.calls.find((c) => c.target === "projects")?.client, "user");
  assertEquals(clientsBuilt(backend), ["user"]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("a thread the caller cannot see in this project: 404 before any service-role client, nothing written", async () => {
  const { res, backend, provider } = await send(post({ ...ASK, thread_id: "t-9" }));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Thread not found or not owned by user" });
  // Looked up by the caller's client, pinned to the request's project.
  const lookup = backend.calls.find((c) => c.target === "chat_threads");
  assertEquals(lookup?.client, "user");
  assertEquals(lookup?.steps.filter(([step]) => step === "eq"), [["eq", "id", "t-9"], ["eq", "project_id", "p-1"]]);
  assertEquals(clientsBuilt(backend), ["user"]);
  assertEquals(provider.calls.length, 0);
  assertEquals(writes(backend.calls), []);
});

// ── The model ────────────────────────────────────────────────────────────

Deno.test("both calls run on the saved model when it is listed", async () => {
  const { res, provider } = await send(post(ASK), { replies: summaryThenFailedReply() });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Overloaded" });
  assertEquals(provider.calls.map((c) => c.model), [MODEL, MODEL]);
});

Deno.test("a saved model off the allowlist: both calls run on the default model", async () => {
  const { res, provider } = await send(post(ASK), {
    profile: { preferred_chat_model: UNLISTED_MODEL },
    env: { ANTHROPIC_API_KEY: "anthropic-key" },
    replies: summaryThenFailedReply(),
  });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Overloaded" });
  assertEquals(provider.calls.map((c) => c.model), [DEFAULT_CHAT_MODEL, DEFAULT_CHAT_MODEL]);
});

Deno.test("an unlisted requested model: 400 before the project is looked up or a provider called", async () => {
  const { res, backend, provider } = await send(post({ ...ASK, model: "gpt-9" }));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Unsupported model: gpt-9" });
  assertEquals(backend.calls.some((c) => c.target === "projects"), false);
  assertEquals(provider.calls.length, 0);
});

// ── CONFIRM ──────────────────────────────────────────────────────────────

Deno.test("CONFIRM for a project the caller cannot see: 404 from the user-scoped read, nothing written", async () => {
  const { res, backend, provider } = await send(post(CONFIRM), { project: false });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Project not found or not owned by user" });
  assertEquals(backend.calls.find((c) => c.target === "projects")?.client, "user");
  assertEquals(writes(backend.calls), []);
  assertEquals(provider.calls.length, 0);
});

Deno.test("CONFIRM: the decision is the one write, by the service-role client, gated on this project's pending row", async () => {
  const { res, backend, provider } = await send(post(CONFIRM));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, inserted_messages: [] });
  assertEquals(writes(backend.calls), [["admin", "ai_editor_actions", { outcome: "accepted" }]]);
  const gate = backend.calls.find((c) => c.target === "ai_editor_actions");
  assertEquals(gate?.steps.filter(([step]) => step === "eq"), [
    ["eq", "id", "a-1"],
    ["eq", "project_id", "p-1"],
    ["eq", "outcome", "pending"],
  ]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("CONFIRM on a decision already recorded: already_resolved, and the reply says nothing changed", async () => {
  const { res } = await send(post({ ...CONFIRM, confirm: false }), { actionDecided: true });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, inserted_messages: [], already_resolved: true });
});

Deno.test("CONFIRM inherits the budget gate: a spent budget answers 403 and records nothing", async () => {
  const { res, backend } = await send(post(CONFIRM), { profile: { tokens_used_this_period: 10_000 } });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Monthly token budget exceeded" });
  assertEquals(writes(backend.calls), []);
});

// ── No tools: the reply streams through ──────────────────────────────────

Deno.test("Ask without documents or web search: responding, thinking, tokens, then done with the reply, the summary delta and the saved rows", async () => {
  const { res, provider } = await send(post(ASK), {
    replies: [summaryReply(), streamedReply(["It reads ", "clearly."], { thinking: true })],
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/event-stream");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  const events = await readEvents(res);

  // The writing summary first (not streamed), then the streamed reply, no tools offered.
  assertEquals(provider.calls.map((c) => [c.stream ?? false, c.tools?.length ?? 0]), [[false, 0], [true, 0]]);
  const total = Math.ceil((sentChars(provider, 0) + sentChars(provider, 1) + SUMMARY.length + REPLY.length) / 4);
  assertEquals(events, [
    { phase: "responding" },
    { phase: "thinking" },
    { token: "It reads " },
    { token: "clearly." },
    {
      done: true,
      ai_response: REPLY,
      truncated: false,
      refused: false,
      summary_update: SUMMARY,
      action_id: null,
      budget_remaining: 10_000 - 100 - total,
      inserted_messages: [{ id: "m-1", ...PROMPT_ROW }, { id: "m-2", ...SUMMARY_ROW }, { id: "m-3", ...REPLY_ROW }],
    },
  ]);
});

Deno.test("everything read before the service-role client exists goes through the caller's client: the guards, then the writing, its summary, the memory and the recent messages", async () => {
  const { res, backend } = await send(post(ASK), { replies: [summaryReply(), streamedReply([REPLY])] });
  await readEvents(res);
  const firstAdminCall = backend.calls.findIndex((c) => c.client === "admin");
  assertEquals(backend.calls.slice(0, firstAdminCall).map((c) => `${c.client} ${c.target}`), [
    "user auth:getUser",
    "user rpc:reset_tokens_if_stale",
    "user profiles",
    "user projects",
    "user chat_threads",
    "user writing_content",
    "user writing_summary_log",
    "user chat_thread_summaries",
    "user chat_messages",
  ]);
});

Deno.test("Ask writes no action row: the exchange and the summary delta (not assessed) go through the service-role client, the usage row and the billing through the caller's", async () => {
  const { res, backend, provider } = await send(post(ASK), { replies: [summaryReply(), streamedReply([REPLY])] });
  await readEvents(res);
  const input = sentChars(provider, 0) + sentChars(provider, 1);
  const output = SUMMARY.length + REPLY.length;
  assertEquals(writes(backend.calls), [
    ["user", "token_usage", {
      user_id: "u-1",
      project_id: "p-1",
      function_name: "context-prompt",
      model_used: MODEL,
      input_tokens: Math.ceil(input / 4),
      output_tokens: Math.ceil(output / 4),
    }],
    ["admin", "chat_messages", PROMPT_ROW],
    ["admin", "chat_messages", SUMMARY_ROW],
    ["admin", "chat_messages", REPLY_ROW],
    ["admin", "writing_summary_log", { project_id: "p-1", summary_text: SUMMARY }],
    ["admin", "project_stats", { chat_prompt_count_normal: 3 }],
  ]);
  assertEquals(billing(backend)?.client, "user");
  assertEquals(billing(backend)?.steps[0][1], { user_uuid: "u-1", amount: Math.ceil((input + output) / 4) });
});

Deno.test("Propose: a pending action row by the service-role client, and done carries its id", async () => {
  const { res, backend } = await send(post(PROPOSE), { replies: [summaryReply(), streamedReply(["The tide rushed in."])] });
  const done = (await readEvents(res)).at(-1);
  assertEquals(done?.action_id, "a-1");
  const [first, ...rest] = writes(backend.calls);
  assertEquals(first, ["admin", "ai_editor_actions", {
    project_id: "p-1",
    action_type: "propose",
    selected_text_preview: "The tide came in.",
    ai_response_preview: "The tide rushed in.",
    ai_response_full: "The tide rushed in.",
    proposed_summary: SUMMARY,
    char_count_original: 17,
    char_count_result: 19,
    outcome: "pending",
    instruction_text: "Make it vivid.",
  }]);
  const chatRows = rest.filter(([, table]) => table === "chat_messages");
  assertEquals(chatRows.map(([client, , values]) => [client, (values as { source_type: string }).source_type]), [
    ["admin", "propose_prompt"],
    ["admin", "writing_summary"],
    ["admin", "propose_response"],
  ]);
});

Deno.test("a summary that already covers the question: no summary row in the chat and no write to the summary log", async () => {
  const { res, backend } = await send(post(ASK), {
    summary: "One sentence about the tide.",
    replies: [jsonReply({ content: "No update needed." }), streamedReply([REPLY])],
  });
  const done = (await readEvents(res)).at(-1);
  assertEquals(done?.summary_update, "No update needed.");
  const tables = writes(backend.calls).map(([, table, values]) =>
    table === "chat_messages" ? (values as { source_type: string }).source_type : table
  );
  assertEquals(tables, ["token_usage", "ask_prompt", "ask_response", "project_stats"]);
});

Deno.test("a summary extended: the chat gets only the new part, the summary log the merged whole", async () => {
  const { res, backend } = await send(post(ASK), {
    summary: "One sentence about the tide.",
    replies: [jsonReply({ content: "Additionally, the tide rose." }), streamedReply([REPLY])],
  });
  await readEvents(res);
  const summaryRow = writes(backend.calls).find(([, , values]) =>
    (values as { source_type?: string }).source_type === "writing_summary"
  );
  assertEquals((summaryRow?.[2] as Record<string, unknown>).content, "Additionally, the tide rose.");
  const log = backend.calls.find((c) => c.client === "admin" && c.target === "writing_summary_log");
  assertEquals((log?.steps[0][1] as Record<string, unknown>).summary_text, "One sentence about the tide.\nAdditionally, the tide rose.");
  assertEquals(log?.steps.find(([step]) => step === "eq"), ["eq", "id", "s-1"]);
});

Deno.test("a reply cut off at the output limit: done says truncated", async () => {
  const { res } = await send(post(ASK), { replies: [summaryReply(), streamedReply(["It reads"], { finish: "length" })] });
  const done = (await readEvents(res)).at(-1);
  assertEquals([done?.ai_response, done?.truncated, done?.refused], ["It reads", true, false]);
});

Deno.test("a provider refusal: done says refused, with the refusal notice as the reply", async () => {
  const { res } = await send(post({ ...ASK, model: "claude-sonnet-4-6" }), {
    env: { ANTHROPIC_API_KEY: "anthropic-key" },
    replies: [Response.json({ content: [{ type: "text", text: SUMMARY }] }), anthropicStreamedReply([], "refusal")],
  });
  const done = (await readEvents(res)).at(-1);
  assertEquals([done?.ai_response, done?.truncated, done?.refused], [fallbackReplyText("refusal"), false, true]);
});

Deno.test("no budget set (NULL): never blocked, and done reports budget_remaining null", async () => {
  const { res } = await send(post(ASK), {
    profile: { monthly_token_budget: null, tokens_used_this_period: 9_999_999 },
    replies: [summaryReply(), streamedReply([REPLY])],
  });
  const done = (await readEvents(res)).at(-1);
  assertEquals([done?.ai_response, done?.budget_remaining], [REPLY, null]);
});

// ── With tools: documents and web search ─────────────────────────────────

Deno.test("documents offered but not used: reviewing, responding, the replayed reply, then done", async () => {
  const { res, provider } = await send(post(ASK), { docs: [NOTES_DOC], replies: [summaryReply(), jsonReply({ content: REPLY })] });
  assertEquals(await readEvents(res).then((events) => events.slice(0, 3)), [
    { phase: "reviewing" },
    { phase: "responding" },
    { token: REPLY },
  ]);
  assertEquals(provider.calls[1].tools?.map((t) => t.function.name), ["read_imported_document"]);
});

Deno.test("a document read: reading_documents, then the final call's tokens; done and the reply row name the document", async () => {
  const { res, backend, provider } = await send(post(ASK), {
    docs: [NOTES_DOC],
    replies: [summaryReply(), readDoc(), jsonReply({ content: "" }), streamedReply(["From your notes."])],
  });
  const events = await readEvents(res);
  assertEquals(events.slice(0, 3), [{ phase: "reviewing" }, { phase: "reading_documents" }, { token: "From your notes." }]);
  assertEquals(events.at(-1)?.documents_referenced, ["d-1"]);
  // The tool decision, the loop's check, the streamed answer.
  assertEquals(provider.calls.slice(1).map((c) => c.stream === true), [false, false, true]);
  // Read by the service-role client, within the request's project.
  const read = backend.calls.find((c) => c.target === "imported_documents" && c.steps.at(-1)?.[0] === "maybeSingle");
  assertEquals(read?.client, "admin");
  assertEquals(read?.steps.filter(([step]) => step === "eq"), [["eq", "id", "d-1"], ["eq", "project_id", "p-1"]]);
  const reply = writes(backend.calls).find(([, , values]) => (values as { source_type?: string }).source_type === "ask_response");
  assertEquals((reply?.[2] as Record<string, unknown>).documents_referenced, ["d-1"]);
});

Deno.test("a document id from another project reads as not found; its text never reaches the model", async () => {
  const { res, provider } = await send(post(ASK), {
    docs: [NOTES_DOC],
    replies: [summaryReply(), readDoc("d-other"), jsonReply({ content: "" }), streamedReply(["I could not find it."])],
  });
  await readEvents(res);
  const toolResult = provider.calls[2].messages.find((m) => m.role === "tool");
  assertEquals(toolResult?.content, "Document not found in this project or text not yet extracted.");
  assert(!JSON.stringify(provider.calls).includes("Another user's text."));
});

Deno.test("web search is offered only when the request asks for it and the operator configured a search key", async () => {
  const cases: [string, Record<string, unknown>, Record<string, string | undefined>, boolean][] = [
    ["asked, no key", { web_search_enabled: true }, {}, false],
    ["a key, not asked", {}, { BRAVE_SEARCH_API_KEY: "brave-key" }, false],
    ["asked, with a key", { web_search_enabled: true }, { BRAVE_SEARCH_API_KEY: "brave-key" }, true],
  ];
  for (const [what, extra, env, offered] of cases) {
    const reply = offered ? jsonReply({ content: REPLY }) : streamedReply([REPLY]);
    const { res, provider } = await send(post({ ...ASK, ...extra }), { env, replies: [summaryReply(), reply] });
    await readEvents(res);
    const tools = provider.calls[1].tools?.map((t) => t.function.name) ?? [];
    assertEquals(tools.includes("web_search"), offered, what);
  }
});

// ── Errors ───────────────────────────────────────────────────────────────

Deno.test("a failed summary call: 500 with the provider's message, before any stream; nothing saved", async () => {
  const { res, backend } = await send(post(ASK), { replies: [overloaded()] });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Mistral: Overloaded" });
  assertEquals(writes(backend.calls), []);
});

Deno.test("a failed first call on the tool path: an error event ends the stream; nothing saved", async () => {
  const { res, backend } = await send(post(ASK), { docs: [NOTES_DOC], replies: [summaryReply(), overloaded()] });
  assertEquals(await readEvents(res), [{ phase: "reviewing" }, { error: "Mistral: Overloaded" }]);
  assertEquals(writes(backend.calls), []);
});

Deno.test("a failed final call after a document read: done carries the provider's error; nothing saved", async () => {
  const { res, backend } = await send(post(ASK), {
    docs: [NOTES_DOC],
    replies: [summaryReply(), readDoc(), jsonReply({ content: "" }), overloaded()],
  });
  assertEquals(await readEvents(res), [
    { phase: "reviewing" },
    { phase: "reading_documents" },
    { done: true, error: "Mistral: Overloaded" },
  ]);
  assertEquals(writes(backend.calls), []);
});

Deno.test("an exchange that was not saved: done carries the error, not the reply", async () => {
  const { res } = await send(post(ASK), { failReplyInsert: true, replies: [summaryReply(), streamedReply([REPLY])] });
  assertEquals(await readEvents(res), [
    { phase: "responding" },
    { token: REPLY },
    { done: true, error: "Messages may not have been saved." },
  ]);
});

// ── A local model (_ollama.ts) ───────────────────────────────────────────

const LOCAL = { profile: { preferred_chat_model: LOCAL_MODEL }, env: LOCAL_ENV };

/** The prompt of a provider call fits the window beside its reply. */
const fitsWindow = (
  call: {
    messages: Parameters<typeof estimatePromptTokens>[0];
    tools?: Parameters<typeof estimatePromptTokens>[1];
    max_tokens: number;
  },
  window: number,
) => estimatePromptTokens(call.messages, call.tools ?? []) + call.max_tokens <= window - 256;

const systemOf = (call: { messages: { content: unknown }[] }) => String(call.messages[0].content);

Deno.test("a listed local model: Ask runs on it, sized to its window; the exchange is saved but not counted", async () => {
  const local = fakeLocalModels({ [LOCAL_MODEL]: 16_384 });
  const { res, backend, provider } = await send(post(ASK), {
    ...LOCAL,
    localModels: local,
    replies: [summaryReply(), streamedReply([REPLY])],
  });
  const events = await readEvents(res);
  assertEquals(local.lookedUp, [LOCAL_MODEL]);
  // The summary call, then the streamed reply: both on the local model, within its window.
  assertEquals(provider.calls.map((c) => [c.model, c.stream ?? false, c.max_tokens]), [
    [LOCAL_MODEL, false, 2_000],
    [LOCAL_MODEL, true, 4_000],
  ]);
  for (const call of provider.calls) assert(fitsWindow(call, 16_384));
  assert(systemOf(provider.calls[1]).includes(`relevant to their request:\n${SUMMARY}\n`), "the reply call reads the summary");
  const done = events.at(-1);
  assertEquals([done?.ai_response, done?.summary_update, done?.budget_remaining], [REPLY, SUMMARY, 10_000 - 100]);
  // The usage row is kept; the billing RPC is not called.
  const input = sentChars(provider, 0) + sentChars(provider, 1);
  const output = SUMMARY.length + REPLY.length;
  assertEquals(writes(backend.calls), [
    ["user", "token_usage", {
      user_id: "u-1",
      project_id: "p-1",
      function_name: "context-prompt",
      model_used: LOCAL_MODEL,
      input_tokens: Math.ceil(input / 4),
      output_tokens: Math.ceil(output / 4),
    }],
    ["admin", "chat_messages", PROMPT_ROW],
    ["admin", "chat_messages", SUMMARY_ROW],
    ["admin", "chat_messages", { ...REPLY_ROW, model_used: LOCAL_MODEL }],
    ["admin", "project_stats", { chat_prompt_count_normal: 3 }],
  ]);
  assertEquals(billing(backend), undefined);
});

Deno.test("local model: the summary call writes a fresh summary; the stored summary is neither read nor changed", async () => {
  const { res, backend, provider } = await send(post(PROPOSE), {
    ...LOCAL,
    summary: "The stored summary.",
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 16_384 }),
    replies: [summaryReply(), streamedReply(["The tide rushed in."])],
  });
  await readEvents(res);
  assert(systemOf(provider.calls[0]).includes("=== EXISTING WRITING SUMMARY (if any) ===\nNone\n"));
  assert(!JSON.stringify(provider.calls).includes("The stored summary."));
  assertEquals(backend.calls.some((c) => c.target === "writing_summary_log"), false);
  // The fresh summary goes to the chat whole, not assessed, and to the pending action row.
  const rows = writes(backend.calls);
  assertEquals((rows[0][2] as Record<string, unknown>).proposed_summary, SUMMARY);
  const summaryRow = rows.find(([, , values]) => (values as { source_type?: string }).source_type === "writing_summary");
  assertEquals(summaryRow, ["admin", "chat_messages", SUMMARY_ROW]);
});

Deno.test("the local model server does not answer: 503 with its message; no provider call, nothing saved", async () => {
  const { res, backend, provider } = await send(post(ASK), { ...LOCAL, localModels: fakeLocalModels() });
  assertEquals(res.status, 503);
  assertEquals(await res.json(), {
    error: "The local model server (Ollama) is not answering. Start Ollama, then try again.",
  });
  assertEquals(provider.calls.length, 0);
  assertEquals(writes(backend.calls), []);
});

Deno.test("a saved local model the instance does not list: 400, and no cloud model runs in its place", async () => {
  const { res, provider } = await send(post(ASK), { profile: { preferred_chat_model: LOCAL_MODEL } });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), {
    error: "Your local model (sylou-nemo-16k) is not set up on this Sylou instance. Pick another model in Settings.",
  });
  assertEquals(provider.calls.length, 0);
});

Deno.test("local model: writing too long for its window: 400 before any provider call; nothing saved", async () => {
  const { res, backend, provider } = await send(post(ASK), {
    ...LOCAL,
    writing: `<p>${"w".repeat(30_000)}</p>`,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
  });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), {
    error: "Too long for sylou-nemo-16k: Ask and Propose read your whole writing and the selection, which need " +
      "more room than its window of 8,192 tokens leaves. Pick a model with a larger window in Settings.",
  });
  assertEquals(provider.calls.length, 0);
  assertEquals(writes(backend.calls), []);
});

Deno.test("local model: a reply that cannot fit even without a conversation: 400 before any provider call", async () => {
  // Thirty documents whose summaries alone fill the window.
  const docs = Array.from({ length: 30 }, (_, i) => ({ ...NOTES_DOC, id: `d-${i}`, summary: "s".repeat(1_000) }));
  const { res, backend, provider } = await send(post(ASK), {
    ...LOCAL,
    docs,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
  });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), {
    error: "Too long for sylou-nemo-16k: this request needs more room than its window of 8,192 tokens leaves. " +
      "Select less text, start a new thread, or pick a model with a larger window in Settings.",
  });
  assertEquals(provider.calls.length, 0);
  assertEquals(writes(backend.calls), []);
});

Deno.test("local model: a long writing that still fits: the summary call's reply gets the room its window leaves", async () => {
  const { res, provider } = await send(post(ASK), {
    ...LOCAL,
    writing: `<p>${"w".repeat(19_000)}</p>`,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [summaryReply(), streamedReply([REPLY])],
  });
  assertEquals((await readEvents(res)).at(-1)?.ai_response, REPLY);
  const summaryCall = provider.calls[0];
  assert(summaryCall.max_tokens >= 600 && summaryCall.max_tokens < 2_000, String(summaryCall.max_tokens));
  assert(fitsWindow(summaryCall, 8_192));
});

Deno.test("local model: a summary that leaves the reply no room: 400 after the summary call; nothing saved", async () => {
  const { res, backend, provider } = await send(post(ASK), {
    ...LOCAL,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [jsonReply({ content: "s".repeat(24_000) })],
  });
  assertEquals(res.status, 400);
  assert(String((await res.json()).error).startsWith("Too long for sylou-nemo-16k: this request needs"));
  assertEquals(provider.calls.length, 1);
  assertEquals(writes(backend.calls), []);
});

Deno.test("local model that cannot call tools: no tool and no web search; the index names no tool", async () => {
  const { res, provider } = await send(post({ ...ASK, web_search_enabled: true }), {
    ...LOCAL,
    env: { ...LOCAL_ENV, BRAVE_SEARCH_API_KEY: "brave-key" },
    docs: [NOTES_DOC],
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 16_384 }, { tools: false }),
    replies: [summaryReply(), streamedReply([REPLY])],
  });
  await readEvents(res);
  assertEquals(provider.calls.map((c) => [c.stream ?? false, c.tools]), [[false, undefined], [true, undefined]]);
  const system = systemOf(provider.calls[1]);
  assert(system.includes("their full text is not available in this request"), system);
  assert(system.includes('- Document: "notes.md"\n  Summary: Field notes'), system);
  assert(!system.includes("read_imported_document") && !system.includes("# WEB SEARCH"), system);
});

Deno.test("local model: a favourite too long for the window goes in as its summary, and the document tool is offered", async () => {
  const thesis = { id: "d-9", file_name: "thesis.md", summary: "A thesis on tides.", extracted_text: "t".repeat(60_000), is_favourite: true };
  const { res, provider } = await send(post(ASK), {
    ...LOCAL,
    docs: [thesis],
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 16_384 }),
    replies: [summaryReply(), jsonReply({ content: "From its summary." })],
  });
  assertEquals((await readEvents(res)).at(-1)?.ai_response, "From its summary.");
  const system = systemOf(provider.calls[1]);
  assert(system.includes('- Document: "thesis.md" (ID: d-9)\n  Summary: A thesis on tides.'), system);
  assert(!system.includes("ttttt"), "the full text stays out");
  assertEquals(provider.calls[1].tools?.map((t) => t.function.name), ["read_imported_document"]);
  assert(fitsWindow(provider.calls[1], 16_384));
});

Deno.test("local model: a favourite that fits goes in whole, as on a cloud model", async () => {
  const notes = { id: "d-8", file_name: "short.md", summary: "Short notes.", extracted_text: "The short notes.", is_favourite: true };
  const { res, provider } = await send(post(ASK), {
    ...LOCAL,
    docs: [notes],
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 16_384 }),
    replies: [summaryReply(), streamedReply([REPLY])],
  });
  await readEvents(res);
  assert(systemOf(provider.calls[1]).includes("# REFERENCE DOCUMENTS (ALWAYS AVAILABLE)"));
  assert(systemOf(provider.calls[1]).includes("=== short.md ===\n\nThe short notes.\n\n"));
  assertEquals(provider.calls[1].tools, undefined);
});

Deno.test("local model: a document read by the tool is cut to the room the window leaves, and the answer fits", async () => {
  const longNotes = { ...NOTES_DOC, extracted_text: "w".repeat(60_000) };
  const { res, provider } = await send(post(ASK), {
    ...LOCAL,
    docs: [longNotes],
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [summaryReply(), readDoc(), jsonReply({ content: "" }), streamedReply(["From your notes."])],
  });
  assertEquals((await readEvents(res)).at(-1)?.ai_response, "From your notes.");
  const result = String(provider.calls[2].messages.find((m) => m.role === "tool")?.content);
  assert(result.startsWith('Document "notes.md":\n\nwww') && result.endsWith(RESULT_CUT_NOTE), result.slice(-100));
  for (const call of provider.calls) assert(fitsWindow(call, 8_192), `call of ${call.max_tokens} tokens`);
  assert(provider.calls[3].max_tokens >= 900, String(provider.calls[3].max_tokens));
});

/** n saved messages of ~1,800 characters (~600 tokens each), a minute apart. */
const longThread = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `${i + 1} ${"m".repeat(1_800)}`,
    created_at: `2026-11-10T10:${String(i).padStart(2, "0")}:00.000Z`,
  }));

Deno.test("local model: a thread too long for the window gets an early memory refresh before the summary call", async () => {
  const { res, provider } = await send(post(ASK), {
    ...LOCAL,
    messages: longThread(10),
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [jsonReply({ content: "1. Direction: tides." }), summaryReply(), streamedReply([REPLY])],
  });
  assertEquals((await readEvents(res)).at(-1)?.ai_response, REPLY);
  // The memory refresh, the summary call, then the reply with the new memory and a shorter window.
  assertEquals(provider.calls.map((c) => c.stream ?? false), [false, false, true]);
  assert(String(provider.calls[0].messages[1].content).startsWith("PREVIOUS MEMORY:"));
  assert(systemOf(provider.calls[1]).includes("=== CURRENT WRITING ==="));
  const reply = systemOf(provider.calls[2]);
  assert(reply.includes("1. Direction: tides."), "the memory is injected");
  assert(!reply.includes("\nuser: 1 mmm"), "the oldest messages left the window");
  for (const call of provider.calls) assert(fitsWindow(call, 8_192), `call of ${call.max_tokens} tokens`);
});

/** A summarizer's answer of ~1,500 characters (~500 tokens in the next prompts). */
const longMemory = () => jsonReply({ content: `1. Direction: ${"d".repeat(1_500)}` });

Deno.test("local model: at most 3 early refreshes, then the 400; neither Ask call runs, nothing saved", async () => {
  const { res, backend, provider } = await send(post(ASK), {
    ...LOCAL,
    messages: longThread(40),
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [longMemory(), longMemory(), longMemory()],
  });
  assertEquals(res.status, 400);
  assert(String((await res.json()).error).startsWith("Too long for sylou-nemo-16k: this request needs"));
  assertEquals(provider.calls.length, 3);
  assert(provider.calls.every((c) => String(c.messages[1].content).startsWith("PREVIOUS MEMORY:")));
  assertEquals(writes(backend.calls).filter(([, table]) => table === "chat_messages"), []);
});

Deno.test("local model: the memory refreshes after the reply at the local threshold, not the cloud one", async () => {
  // Twenty short messages: a local model's 16k-window threshold, far below the cloud's 50.
  const thread = longThread(20).map((m) => ({ ...m, content: m.content.slice(0, 40) }));
  const { res, provider } = await send(post(ASK), {
    ...LOCAL,
    messages: thread,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 16_384 }),
    replies: [summaryReply(), streamedReply([REPLY]), jsonReply({ content: "1. Direction: tides." })],
  });
  await readEvents(res);
  assertEquals(provider.calls.map((c) => c.stream ?? false), [false, true, false]);
  assert(String(provider.calls[2].messages[1].content).startsWith("PREVIOUS MEMORY:"));
  assert(fitsWindow(provider.calls[2], 16_384));
});

Deno.test("CONFIRM on a local model: the decision is recorded without asking the model server", async () => {
  const local = fakeLocalModels();
  const { res, backend } = await send(post(CONFIRM), { ...LOCAL, localModels: local });
  assertEquals(res.status, 200);
  assertEquals(writes(backend.calls), [["admin", "ai_editor_actions", { outcome: "accepted" }]]);
  assertEquals(local.lookedUp, []);
});
