// editor-action/index.test.ts — the editor-action handler over HTTP: CORS,
// the guard sequence (token → profile → budget → request checks → project
// visibility), the model a selection rewrite runs on, the favourite documents
// it reads, the SSE contract (token / done, the truncated and refused flags,
// the done that carries an error) with the rows it saves, and the JSON reply
// of a request without stream: true.
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fallbackReplyText } from "../_shared/_llm.ts";
import { DEFAULT_CHAT_MODEL, INPUT_LIMITS } from "../_shared/_models.ts";
import {
  anthropicStreamedReply,
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeEnv,
  fakeProvider,
  importHandler,
  jsonReply,
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
const SELECTION = { project_id: "p-1", action_type: "rewrite", selected_text: "The tide came in." };
const REWRITE = { ...SELECTION, stream: true };
const RESULT = "The tide rose.";
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };

interface World {
  /** Profile overrides; null = no profile row. */
  profile?: Record<string, unknown> | null;
  /** false = RLS hides project p-1 from the caller. */
  project?: boolean;
  /** Project p-1's imported documents. */
  docs?: Record<string, unknown>[];
  /** The ai_editor_actions insert fails. */
  failActionInsert?: boolean;
}

/** Another user's favourite document, in project p-2. */
const FOREIGN_FAVOURITE = {
  project_id: "p-2",
  file_name: "theirs.md",
  extracted_text: "Another user's notes.",
  is_favourite: true,
};

/** Project p-1, visible to user u-1 (budget 10,000, 100 used), with no documents unless given. */
function world(w: World) {
  return (call: DbCall): DbResult | undefined => {
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
        return w.project === false ? NO_ROW : { data: { id: "p-1" }, error: null };
      case "admin imported_documents": {
        // Filtered by the eq steps the handler sends, as the database would.
        const rows = [...(w.docs ?? []).map((d) => ({ project_id: "p-1", ...d })), FOREIGN_FAVOURITE];
        const matching = rows.filter((row) =>
          call.steps.every(([step, column, value]) =>
            step !== "eq" || (row as Record<string, unknown>)[String(column)] === value
          )
        );
        return { data: matching, error: null };
      }
      case "admin ai_editor_actions":
        return w.failActionInsert
          ? { data: null, error: { message: "insert denied" } }
          : { data: { id: "a-1" }, error: null };
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

const billing = (backend: ReturnType<typeof fakeBackend>) =>
  backend.calls.find((c) => c.target === "rpc:increment_tokens_used");

/** The characters of what the handler sent the provider: the billing estimate's input. */
const inputChars = (provider: ReturnType<typeof fakeProvider>) =>
  provider.calls[0].messages.reduce((sum, m) => sum + String(m.content).length, 0);

// The rewrite call fails, so the request ends before a stream opens and
// nothing is saved.
const failedRewrite = () => Response.json({ message: "Overloaded" }, { status: 503 });

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
    const { res, backend } = await send(post(REWRITE, { authorization }));
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "Missing authorization" });
    assertEquals(backend.created, []);
  }
});

Deno.test("a token Supabase Auth rejects: 401; only the user-scoped client exists, carrying that token", async () => {
  const { res, backend, provider } = await send(post(REWRITE), { user: null });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(backend.created, [{ client: "user", authorization: "Bearer user-jwt" }]);
  assertEquals(backend.calls.map((c) => `${c.client} ${c.target}`), ["user auth:getUser"]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("no profile row: 404", async () => {
  const { res, backend } = await send(post(REWRITE), { profile: null });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Profile not found" });
  assertEquals(clientsBuilt(backend), ["user"]);
});

Deno.test("budget spent: 403 before the body is read, a provider called or the service-role client built", async () => {
  const req = post(REWRITE);
  const { res, backend, provider } = await send(req, { profile: { tokens_used_this_period: 10_000 } });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Monthly token budget exceeded" });
  assertEquals(req.bodyUsed, false);
  assertEquals(provider.calls.length, 0);
  assertEquals(clientsBuilt(backend), ["user"]);
});

const TOO_LONG_FIELD = "x".repeat(INPUT_LIMITS.SHORT_FIELD_CHARS + 1);
const REJECTED: [string, Record<string, unknown>, string][] = [
  ["a missing selection", { project_id: "p-1", action_type: "rewrite", stream: true }, "project_id, action_type, and selected_text are required"],
  ["a selection that is not text", { ...REWRITE, selected_text: 42 }, "project_id, action_type, and selected_text are required"],
  [
    "an over-long selection",
    { ...REWRITE, selected_text: "x".repeat(INPUT_LIMITS.SELECTED_TEXT_CHARS + 1) },
    `Selection is too long (max ${INPUT_LIMITS.SELECTED_TEXT_CHARS.toLocaleString("en-US")} characters)`,
  ],
  ["a target language that is not text", { ...REWRITE, action_type: "translate", target_language: 7 }, "Invalid target_language"],
  ["an over-long target language", { ...REWRITE, action_type: "translate", target_language: TOO_LONG_FIELD }, "Invalid target_language"],
  ["an over-long source note", { ...REWRITE, selected_text_source: TOO_LONG_FIELD }, "Invalid selected_text_source"],
  ["an unknown action", { ...REWRITE, action_type: "summarize" }, "Invalid action_type: summarize"],
  ["a translation without a language", { ...REWRITE, action_type: "translate" }, "target_language is required for translate action"],
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
  const { res, backend, provider } = await send(post(REWRITE), { project: false });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Project not found or not owned by user" });
  assertEquals(backend.calls.find((c) => c.target === "projects")?.client, "user");
  assertEquals(clientsBuilt(backend), ["user"]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("the model's provider key is not configured: 500 before any provider call", async () => {
  const { res, provider } = await send(post(REWRITE), { env: { MISTRAL_API_KEY: undefined } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "mistral API key not configured" });
  assertEquals(provider.calls.length, 0);
});

// ── The model and the documents ──────────────────────────────────────────

Deno.test("the rewrite runs on the saved model when it is listed", async () => {
  const { res, provider } = await send(post(REWRITE), { replies: [failedRewrite()] });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Overloaded" });
  assertEquals(provider.calls.map((c) => c.model), [MODEL]);
});

Deno.test("a saved model off the allowlist: the rewrite runs on the default model", async () => {
  const { res, provider } = await send(post(REWRITE), {
    profile: { preferred_chat_model: UNLISTED_MODEL },
    env: { ANTHROPIC_API_KEY: "anthropic-key" },
    replies: [failedRewrite()],
  });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Overloaded" });
  assertEquals(provider.calls.map((c) => c.model), [DEFAULT_CHAT_MODEL]);
});

Deno.test("an unlisted requested model: 400 and no provider call", async () => {
  const { res, provider } = await send(post({ ...REWRITE, model: "gpt-9" }));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Unsupported model: gpt-9" });
  assertEquals(provider.calls.length, 0);
});

Deno.test("this project's favourite documents reach the system prompt; other documents and other projects' do not", async () => {
  const { res, backend, provider } = await send(post(REWRITE), {
    docs: [
      { file_name: "style.md", extracted_text: "Prefer short sentences.", is_favourite: true },
      { file_name: "notes.md", extracted_text: "Raw field notes.", is_favourite: false },
    ],
    replies: [streamedReply([RESULT])],
  });
  await readEvents(res);
  const system = String(provider.calls[0].messages[0].content);
  assert(system.includes("=== style.md ===\n\nPrefer short sentences."));
  assert(!system.includes("Raw field notes."));
  assert(!JSON.stringify(provider.calls).includes("Another user's notes."));
  // Read by the service-role client, within the caller's project.
  const read = backend.calls.find((c) => c.target === "imported_documents");
  assertEquals(read?.client, "admin");
  assertEquals(read?.steps.filter(([step]) => step === "eq"), [["eq", "project_id", "p-1"], ["eq", "is_favourite", true]]);
});

// ── The SSE contract ─────────────────────────────────────────────────────

Deno.test("streamed rewrite: tokens, then done with the result, the flags, the action id and the budget left", async () => {
  const { res, provider } = await send(post(REWRITE), { replies: [streamedReply(["The tide ", "rose."])] });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/event-stream");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);

  const events = await readEvents(res);
  // One streamed call: the action's instruction, then the selection.
  assertEquals(provider.calls.map((c) => c.stream), [true]);
  const [system, selection] = provider.calls[0].messages;
  assert(String(system.content).startsWith("Rewrite the following text"));
  assertEquals(selection, { role: "user", content: "The tide came in." });

  const amount = Math.ceil((inputChars(provider) + RESULT.length) / 4);
  assertEquals(events, [
    { token: "The tide " },
    { token: "rose." },
    {
      done: true,
      result: RESULT,
      truncated: false,
      refused: false,
      action_id: "a-1",
      budget_remaining: 10_000 - 100 - amount,
    },
  ]);
});

Deno.test("streamed rewrite: the pending action row and the usage row are written by the service-role client, and billed to the caller", async () => {
  const { res, backend, provider } = await send(post(REWRITE), { replies: [streamedReply([RESULT])] });
  await readEvents(res);
  const amount = Math.ceil((inputChars(provider) + RESULT.length) / 4);
  assertEquals(writes(backend.calls), [
    ["admin", "ai_editor_actions", {
      project_id: "p-1",
      action_type: "rewrite",
      selected_text_preview: "The tide came in.",
      ai_response_preview: RESULT,
      char_count_original: 17,
      char_count_result: 14,
      outcome: "pending",
      instruction_text: null,
    }],
    ["admin", "token_usage", {
      user_id: "u-1",
      project_id: "p-1",
      function_name: "editor-action",
      model_used: MODEL,
      input_tokens: Math.ceil(inputChars(provider) / 4),
      output_tokens: Math.ceil(RESULT.length / 4),
    }],
  ]);
  assertEquals(billing(backend)?.client, "admin");
  assertEquals(billing(backend)?.steps[0][1], { user_uuid: "u-1", amount });
});

Deno.test("a translation with a source note: the prompt names the language, and the action row records both", async () => {
  const { res, backend, provider } = await send(
    post({ ...REWRITE, action_type: "translate", target_language: "French", selected_text_source: "typed 100%" }),
    { replies: [streamedReply(["La marée est montée."])] },
  );
  await readEvents(res);
  assert(String(provider.calls[0].messages[0].content).startsWith("Translate the following text to French."));
  const action = writes(backend.calls).find(([, table]) => table === "ai_editor_actions")?.[2] as Record<string, unknown>;
  assertEquals([action.action_type, action.instruction_text], ["translate", "translate:French | Source: typed 100%"]);
});

Deno.test("a reply cut off at the output limit: done says truncated", async () => {
  const { res } = await send(post(REWRITE), { replies: [streamedReply(["The tide"], { finish: "length" })] });
  const done = (await readEvents(res)).at(-1);
  assertEquals([done?.result, done?.truncated, done?.refused], ["The tide", true, false]);
});

Deno.test("a provider refusal: done says refused, with the refusal notice as the result", async () => {
  const { res } = await send(post({ ...REWRITE, model: "claude-sonnet-4-6" }), {
    env: { ANTHROPIC_API_KEY: "anthropic-key" },
    replies: [anthropicStreamedReply([], "refusal")],
  });
  const done = (await readEvents(res)).at(-1);
  assertEquals([done?.result, done?.truncated, done?.refused], [fallbackReplyText("refusal"), false, true]);
});

Deno.test("no budget set (NULL): never blocked, and done reports budget_remaining null", async () => {
  const { res } = await send(post(REWRITE), {
    profile: { monthly_token_budget: null, tokens_used_this_period: 9_999_999 },
    replies: [streamedReply([RESULT])],
  });
  const done = (await readEvents(res)).at(-1);
  assertEquals([done?.result, done?.budget_remaining], [RESULT, null]);
});

Deno.test("an action row that was not saved: done carries the error, never the result", async () => {
  const { res } = await send(post(REWRITE), { failActionInsert: true, replies: [streamedReply([RESULT])] });
  assertEquals(await readEvents(res), [
    { token: RESULT },
    { done: true, error: "Action may not have been saved." },
  ]);
});

Deno.test("a provider error before the stream: 502 with the provider's message; nothing saved or billed", async () => {
  const { res, backend } = await send(post(REWRITE), {
    replies: [Response.json({ message: "Rate limit exceeded" }, { status: 429 })],
  });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Rate limit exceeded" });
  assertEquals(writes(backend.calls), []);
  assertEquals(billing(backend), undefined);
});

Deno.test("a provider stream that cannot be read: done carries the service error; nothing saved", async () => {
  const { res, backend } = await send(post(REWRITE), { replies: [new Response(null, { status: 200 })] });
  assertEquals(await readEvents(res), [{ done: true, error: "AI service temporarily unavailable." }]);
  assertEquals(writes(backend.calls), []);
});

// ── Without stream: true ─────────────────────────────────────────────────

Deno.test("without stream: true, a JSON reply; the action row goes through the service-role client, the usage row through the caller's", async () => {
  const { res, backend, provider } = await send(post(SELECTION), { replies: [jsonReply({ content: RESULT })] });
  assertEquals(res.status, 200);
  assertEquals(provider.calls.map((c) => c.stream), [undefined]);
  const amount = Math.ceil((inputChars(provider) + RESULT.length) / 4);
  assertEquals(await res.json(), {
    proposed_text: RESULT,
    refused: false,
    action_id: "a-1",
    tokens_used: amount,
    budget_remaining: 10_000 - 100 - amount,
  });
  assertEquals(writes(backend.calls).map(([client, table]) => `${client} ${table}`), [
    "admin ai_editor_actions",
    "user token_usage",
  ]);
  assertEquals(billing(backend)?.client, "admin");
});

Deno.test("without stream: true, a provider error: 502; nothing saved or billed", async () => {
  const { res, backend } = await send(post(SELECTION), { replies: [failedRewrite()] });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Overloaded" });
  assertEquals(writes(backend.calls), []);
  assertEquals(billing(backend), undefined);
});
