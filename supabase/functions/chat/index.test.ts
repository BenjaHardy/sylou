// chat/index.test.ts — the chat handler over HTTP: CORS, the guard sequence
// (token → profile → budget → request checks → thread visibility) and the
// SSE contract (phase / token / done, and the done that carries an error).
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DEFAULT_CHAT_MODEL, INPUT_LIMITS } from "../_shared/_models.ts";
import { estimatePromptTokens } from "../_shared/_fit.ts";
import { RESULT_CUT_NOTE } from "../_shared/_tool_loop.ts";
import { CLASSIC_MODE_SYSTEM_PROMPT, TEMPLATE_PROMPTS, WEB_SEARCH_PROMPT } from "../_shared/_prompts.ts";
import { buildDocIndex, buildFavBlock } from "./context.ts";
import {
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
const ASK = { thread_id: "t-1", message: "  Hi there  ", stream: true };
const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };

interface World {
  /** Profile overrides; null = no profile row. */
  profile?: Record<string, unknown> | null;
  /** false = RLS hides the thread from the caller. */
  thread?: boolean;
  /** The project's imported documents. */
  docs?: Record<string, unknown>[];
  /** The thread's saved messages, oldest first. */
  messages?: { role: string; content: string; created_at: string }[];
  /** The thread's conversation memory, if it has one. */
  memory?: Record<string, unknown>;
  /** The assistant-message insert fails. */
  failAssistantInsert?: boolean;
}

/** Thread t-1 in project p-1, visible to user u-1: no history, no memory,
 *  no documents unless given. A memory the refresh writes is read back. */
function world(w: World) {
  let inserts = 0;
  let memory: Record<string, unknown> | null = w.memory ?? null;
  // The thread's messages a read selects: its created_at bounds, order and limit.
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
      case "user chat_threads":
        return w.thread === false ? NO_ROW : { data: { id: "t-1", project_id: "p-1" }, error: null };
      case "user projects":
      case "admin projects":
        return { data: { tutor_mode: false, template: "general" }, error: null };
      case "admin chat_threads":
        return { data: { project_id: "p-1" }, error: null };
      case "user chat_messages":
        return { data: readMessages(call.steps).map(({ role, content }) => ({ role, content })), error: null };
      case "admin imported_documents": {
        // This project's documents and another user's, filtered by the eq
        // steps the handler sends, as the database would.
        const rows = [...(w.docs ?? []).map((d) => ({ project_id: "p-1", ...d })), FOREIGN_DOC];
        const matching = rows.filter((row) =>
          call.steps.every(([step, column, value]) =>
            step !== "eq" || (row as Record<string, unknown>)[String(column)] === value
          )
        );
        return last === "maybeSingle" ? { data: matching[0] ?? null, error: null } : { data: matching, error: null };
      }
      case "admin chat_messages": {
        // The memory refresh's candidate read.
        if (first !== "insert") return { data: readMessages(call.steps), error: null };
        inserts++;
        const values = call.steps[0][1] as Record<string, unknown>;
        return w.failAssistantInsert && values.role === "assistant"
          ? { data: null, error: { message: "insert denied" } }
          : { data: { id: `m-${inserts}`, ...values }, error: null };
      }
      case "admin project_stats":
        return first === "select" ? { data: { chat_prompt_count_normal: 2 }, error: null } : undefined;
    }
    return undefined;
  };
}

async function send(
  req: Request,
  opts: {
    world?: World;
    user?: { id: string } | null;
    replies?: Response[];
    env?: Record<string, string | undefined>;
    localModels?: ReturnType<typeof fakeLocalModels>;
  } = {},
) {
  const backend = fakeBackend({
    user: opts.user === undefined ? { id: "u-1" } : opts.user,
    respond: world(opts.world ?? {}),
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
  const { res, backend } = await send(post(ASK), { world: { profile: null } });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Profile not found" });
  assertEquals(clientsBuilt(backend), ["user"]);
});

Deno.test("budget spent: 403 before the body is read, a provider called or the service-role client built", async () => {
  const req = post(ASK);
  const { res, backend, provider } = await send(req, { world: { profile: { tokens_used_this_period: 10_000 } } });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Monthly token budget exceeded" });
  assertEquals(req.bodyUsed, false);
  assertEquals(provider.calls.length, 0);
  assertEquals(clientsBuilt(backend), ["user"]);
});

const REJECTED: [string, Record<string, unknown>, string][] = [
  ["an unlisted model", { ...ASK, model: "gpt-9" }, "Unsupported model: gpt-9"],
  ["a non-streaming request", { thread_id: "t-1", message: "Hi" }, "Only streaming requests are supported (send stream: true)"],
  ["a missing message", { thread_id: "t-1", stream: true }, "thread_id and message are required"],
  [
    "an over-long message",
    { ...ASK, message: "x".repeat(INPUT_LIMITS.CHAT_MESSAGE_CHARS + 1) },
    `Message is too long (max ${INPUT_LIMITS.CHAT_MESSAGE_CHARS.toLocaleString("en-US")} characters)`,
  ],
];

for (const [what, body, error] of REJECTED) {
  Deno.test(`${what}: 400 before the thread is looked up or a provider called`, async () => {
    const { res, backend, provider } = await send(post(body));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error });
    assertEquals(backend.calls.some((c) => c.target === "chat_threads"), false);
    assertEquals(provider.calls.length, 0);
    assertEquals(clientsBuilt(backend), ["user"]);
  });
}

Deno.test("a thread RLS hides from the caller: 404 from the user-scoped read, no service-role client", async () => {
  const { res, backend, provider } = await send(post(ASK), { world: { thread: false } });
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Thread not found or not owned by user" });
  assertEquals(backend.calls.find((c) => c.target === "chat_threads")?.client, "user");
  assertEquals(clientsBuilt(backend), ["user"]);
  assertEquals(provider.calls.length, 0);
});

Deno.test("the model's provider key is not configured: 500 before any provider call", async () => {
  const { res, provider } = await send(post(ASK), { env: { MISTRAL_API_KEY: undefined } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "mistral API key not configured" });
  assertEquals(provider.calls.length, 0);
});

// ── The SSE contract ─────────────────────────────────────────────────────

const USER_ROW = {
  thread_id: "t-1",
  role: "user",
  content: "Hi there",
  source_type: "chat",
  flow_flag: "normal",
  concise_mode: false,
  tutor_mode: false,
};
const ASSISTANT_ROW = { ...USER_ROW, role: "assistant", content: "Hello!", model_used: MODEL };

Deno.test("streamed reply: thinking phase, tokens, then done with the rows the service-role client saved", async () => {
  const { res, backend, provider } = await send(post(ASK), {
    replies: [streamedReply(["Hel", "lo!"], { thinking: true })],
  });
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/event-stream");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);

  // One streamed call on the profile's model, ending with the trimmed message.
  assertEquals(provider.calls.length, 1);
  assertEquals(provider.calls[0].model, MODEL);
  assertEquals(provider.calls[0].stream, true);
  assertEquals(provider.calls[0].messages.at(-1), { role: "user", content: "Hi there" });

  const events = await readEvents(res);
  assertEquals(events.slice(0, 3), [{ phase: "thinking" }, { token: "Hel" }, { token: "lo!" }]);
  assertEquals(events.length, 4);

  // Every write went through the service-role client; the caller's client wrote nothing.
  assertEquals(writes(backend.calls), [
    ["admin", "chat_messages", USER_ROW],
    ["admin", "chat_messages", ASSISTANT_ROW],
    ["admin", "project_stats", { chat_prompt_count_normal: 3 }],
  ]);
  assertEquals(backend.created, [
    { client: "user", authorization: "Bearer user-jwt" },
    { client: "admin", authorization: null },
  ]);

  // Billed through the single accounting RPC; done reports what is left.
  const billing = backend.calls.find((c) => c.target === "rpc:increment_tokens_used");
  assertEquals(billing?.client, "admin");
  const { user_uuid, amount } = billing?.steps[0][1] as { user_uuid: string; amount: number };
  assertEquals(user_uuid, "u-1");
  assert(amount > 0);
  assertEquals(events[3], {
    done: true,
    user_message: { id: "m-1", ...USER_ROW },
    assistant_message: { id: "m-2", ...ASSISTANT_ROW },
    budget_remaining: 10_000 - 100 - amount,
  });
});

Deno.test("a saved model off the allowlist: the reply runs on the default model, and the saved row names it", async () => {
  const { res, backend, provider } = await send(post(ASK), {
    world: { profile: { preferred_chat_model: UNLISTED_MODEL } },
    env: { ANTHROPIC_API_KEY: "anthropic-key" },
    replies: [streamedReply(["Hello!"])],
  });
  assertEquals((await readEvents(res)).at(-1)?.done, true);
  assertEquals(provider.calls.map((c) => c.model), [DEFAULT_CHAT_MODEL]);
  const assistant = writes(backend.calls).find(([, , values]) => (values as { role?: string }).role === "assistant");
  assertEquals((assistant?.[2] as Record<string, unknown>).model_used, DEFAULT_CHAT_MODEL);
});

Deno.test("no budget set (NULL): never blocked, and done reports budget_remaining null", async () => {
  const { res } = await send(post(ASK), {
    world: { profile: { monthly_token_budget: null, tokens_used_this_period: 9_999_999 } },
    replies: [streamedReply(["Hello!"])],
  });
  const events = await readEvents(res);
  assertEquals(events.at(-1)?.done, true);
  assertEquals(events.at(-1)?.budget_remaining, null);
});

Deno.test("an exchange that was not saved still ends the stream: done carries the error, not the rows", async () => {
  const { res } = await send(post(ASK), {
    world: { failAssistantInsert: true },
    replies: [streamedReply(["Hello!"])],
  });
  assertEquals(await readEvents(res), [
    { token: "Hello!" },
    { done: true, error: "Messages may not have been saved." },
  ]);
});

Deno.test("a provider error before the stream: 502 with the provider's message; nothing saved", async () => {
  const { res, backend } = await send(post(ASK), {
    replies: [Response.json({ message: "Rate limit exceeded" }, { status: 429 })],
  });
  assertEquals(res.status, 502);
  assertEquals(await res.json(), { error: "Mistral: Rate limit exceeded" });
  assertEquals(writes(backend.calls), []);
});

const DOCS = [{ id: "d-1", file_name: "notes.md", summary: "Field notes", extracted_text: "The field notes.", is_favourite: false }];
const FOREIGN_DOC = {
  id: "d-other",
  project_id: "p-2",
  file_name: "secret.md",
  summary: "Someone else's notes",
  extracted_text: "Another user's text.",
  is_favourite: false,
};
const readDoc = () => jsonReply({
  toolCalls: [{ id: "call-1", name: "read_imported_document", arguments: { document_id: "d-1" } }],
});

Deno.test("tool path: reading_documents phase, then the final call's tokens; the document is recorded", async () => {
  const { res, backend, provider } = await send(post(ASK), {
    world: { docs: DOCS },
    replies: [readDoc(), jsonReply({ content: "" }), streamedReply(["From your notes."])],
  });
  const events = await readEvents(res);
  assertEquals(events.slice(0, 2), [{ phase: "reading_documents" }, { token: "From your notes." }]);
  assertEquals(events.at(-1)?.done, true);

  // The tool decision, the loop's check, the streamed answer.
  assertEquals(provider.calls.map((c) => c.stream === true), [false, false, true]);
  assertEquals(provider.calls[0].tools?.map((t) => t.function.name), ["read_imported_document"]);

  // The document was read by the service-role client, within the thread's project.
  const read = backend.calls.find((c) => c.target === "imported_documents" && c.steps.at(-1)?.[0] === "maybeSingle");
  assertEquals(read?.client, "admin");
  assertEquals(read?.steps.filter(([step]) => step === "eq"), [["eq", "id", "d-1"], ["eq", "project_id", "p-1"]]);
  const assistant = writes(backend.calls).find(([, , values]) => (values as { role?: string }).role === "assistant");
  assertEquals((assistant?.[2] as Record<string, unknown>).documents_referenced, ["d-1"]);
});

Deno.test("tool path: a document id from another project reads as not found; its text never reaches the model", async () => {
  const { res, backend, provider } = await send(post(ASK), {
    world: { docs: DOCS },
    replies: [
      jsonReply({ toolCalls: [{ id: "call-1", name: "read_imported_document", arguments: { document_id: "d-other" } }] }),
      jsonReply({ content: "" }),
      streamedReply(["I could not find that document."]),
    ],
  });
  await readEvents(res);

  // The read carried the thread's project, so the other project's row never matched.
  const read = backend.calls.find((c) => c.target === "imported_documents" && c.steps.at(-1)?.[0] === "maybeSingle");
  assertEquals(read?.steps.filter(([step]) => step === "eq"), [["eq", "id", "d-other"], ["eq", "project_id", "p-1"]]);
  const toolResult = provider.calls[1].messages.find((m) => m.role === "tool");
  assertEquals(toolResult?.content, "Document not found in this project or text not yet extracted.");
  assert(!JSON.stringify(provider.calls).includes("Another user's text."));
});

Deno.test("tool path: a failed final call ends the stream with an error-carrying done; nothing saved", async () => {
  const { res, backend } = await send(post(ASK), {
    world: { docs: DOCS },
    replies: [readDoc(), jsonReply({ content: "" }), Response.json({ message: "Overloaded" }, { status: 503 })],
  });
  assertEquals(await readEvents(res), [
    { phase: "reading_documents" },
    { done: true, error: "Mistral: Overloaded" },
  ]);
  assertEquals(writes(backend.calls), []);
});

Deno.test("a cloud chat's system prompt: mode, index, favourites, then web search, as before", async () => {
  const docs = [
    ...DOCS,
    { id: "d-2", file_name: "style.md", summary: "House style", extracted_text: "Write plainly.", is_favourite: true },
  ];
  const { res, provider } = await send(post({ ...ASK, web_search_enabled: true }), {
    world: { docs },
    env: { BRAVE_SEARCH_API_KEY: "brave-key" },
    replies: [jsonReply({ content: "Hello!" })],
  });
  await readEvents(res);
  // (The world's "general" template adds no prompt of its own.)
  assertEquals(TEMPLATE_PROMPTS.general, undefined);
  const expected = CLASSIC_MODE_SYSTEM_PROMPT +
    buildDocIndex([docs[0] as { id: string; file_name: string; summary: string }]) +
    buildFavBlock([docs[1] as { file_name: string; extracted_text: string }], true) +
    WEB_SEARCH_PROMPT;
  assertEquals(provider.calls[0].messages[0], { role: "system", content: expected });
  assertEquals(provider.calls[0].tools?.map((t) => t.function.name), ["read_imported_document", "web_search"]);
  assertEquals(provider.calls[0].max_tokens, 4_000);
});

// ── The conversation memory on a cloud model ─────────────────────────────

/** n saved messages "m1" … "mn", a minute apart. */
const savedThread = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `m${i + 1}`,
    created_at: `2026-11-10T10:${String(i).padStart(2, "0")}:00.000Z`,
  }));

Deno.test("cloud chat: the memory, the 20 messages before its watermark, everything after it, then the message", async () => {
  const messages = savedThread(60);
  const memory = { summary_text: "The plan so far.", covers_through: messages[39].created_at, covered_message_count: 40, updated_at: "" };
  const { res, provider } = await send(post(ASK), { world: { messages, memory }, replies: [streamedReply(["Ok."])] });
  await readEvents(res);
  const sent = provider.calls[0].messages;
  assertEquals(sent[1].role, "user");
  assert(String(sent[1].content).startsWith("[CONVERSATION MEMORY]") && String(sent[1].content).includes("The plan so far."));
  assertEquals(sent.slice(2, -1).map((m) => m.content), messages.slice(20).map((m) => m.content)); // m21 … m60
  assertEquals(sent.at(-1), { role: "user", content: "Hi there" });
  assertEquals(provider.calls.length, 1, "20 unsummarised messages: no refresh");
});

Deno.test("cloud chat: the memory refreshes after the reply once 50 messages are unsummarised, not before", async () => {
  const below = await send(post(ASK), { world: { messages: savedThread(49) }, replies: [streamedReply(["Ok."])] });
  await readEvents(below.res);
  assertEquals(below.provider.calls.length, 1);

  const { res, backend, provider } = await send(post(ASK), {
    world: { messages: savedThread(50) },
    replies: [streamedReply(["Ok."]), jsonReply({ content: "1. Direction: the plan." })],
  });
  await readEvents(res);
  // Without a memory yet, the reply saw the newest 70 messages (here all 50).
  assertEquals(provider.calls[0].messages.length, 1 + 50 + 1);
  const summarizer = provider.calls[1];
  assert(String(summarizer.messages[1].content).startsWith("PREVIOUS MEMORY:"));
  assertEquals(summarizer.max_tokens, 3_000);
  const saved = writes(backend.calls).find(([, table]) => table === "chat_thread_summaries")?.[2] as Record<string, unknown>;
  assertEquals([saved.covered_message_count, saved.summary_text], [50, "1. Direction: the plan."]);
});

// ── A local model (_ollama.ts) ───────────────────────────────────────────

const LOCAL = { profile: { preferred_chat_model: LOCAL_MODEL } };

/** The prompt of a provider call fits the window beside its reply. */
const fitsWindow = (call: { messages: Parameters<typeof estimatePromptTokens>[0]; tools?: Parameters<typeof estimatePromptTokens>[1]; max_tokens: number }, window: number) =>
  estimatePromptTokens(call.messages, call.tools ?? []) + call.max_tokens <= window - 256;

Deno.test("a listed local model: chat runs on it, sized to its window; the exchange is saved but not counted", async () => {
  const local = fakeLocalModels({ [LOCAL_MODEL]: 16_384 });
  const { res, backend, provider } = await send(post(ASK), {
    world: LOCAL,
    env: LOCAL_ENV,
    localModels: local,
    replies: [streamedReply(["Hello!"])],
  });
  const events = await readEvents(res);
  assertEquals(local.lookedUp, [LOCAL_MODEL]);
  assertEquals(provider.calls.map((c) => [c.model, c.max_tokens, c.tools]), [[LOCAL_MODEL, 4_000, undefined]]);
  assertEquals(events.at(-1)?.budget_remaining, 10_000 - 100);
  assertEquals(backend.calls.find((c) => c.target === "rpc:increment_tokens_used"), undefined);
  const assistant = writes(backend.calls).find(([, , values]) => (values as { role?: string }).role === "assistant");
  assertEquals((assistant?.[2] as Record<string, unknown>).model_used, LOCAL_MODEL);
});

Deno.test("the local model server does not answer: 503 with its message, and no provider call", async () => {
  const { res, provider } = await send(post(ASK), { world: LOCAL, env: LOCAL_ENV, localModels: fakeLocalModels() });
  assertEquals(res.status, 503);
  assertEquals(await res.json(), {
    error: "The local model server (Ollama) is not answering. Start Ollama, then try again.",
  });
  assertEquals(provider.calls.length, 0);
});

Deno.test("a saved local model the instance does not list: 400, and no cloud model runs in its place", async () => {
  const { res, provider } = await send(post(ASK), { world: LOCAL });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), {
    error: "Your local model (sylou-nemo-16k) is not set up on this Sylou instance. Pick another model in Settings.",
  });
  assertEquals(provider.calls.length, 0);
});

Deno.test("local model: a favourite too long for the window goes in as its summary, and the document tool is offered", async () => {
  const thesis = { id: "d-9", file_name: "thesis.md", summary: "A thesis on tides.", extracted_text: "t".repeat(60_000), is_favourite: true };
  const { res, provider } = await send(post(ASK), {
    world: { ...LOCAL, docs: [thesis] },
    env: LOCAL_ENV,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 16_384 }),
    replies: [jsonReply({ content: "From its summary." })],
  });
  assertEquals((await readEvents(res)).at(-1)?.done, true);
  const system = String(provider.calls[0].messages[0].content);
  assert(system.includes('- Document: "thesis.md" (ID: d-9)\n  Summary: A thesis on tides.'), system);
  assert(!system.includes("ttttt"), "the full text stays out");
  assertEquals(provider.calls[0].tools?.map((t) => t.function.name), ["read_imported_document"]);
  assert(fitsWindow(provider.calls[0], 16_384));
});

Deno.test("local model that cannot call tools: no tool and no web search; the index names no tool", async () => {
  const { res, provider } = await send(post({ ...ASK, web_search_enabled: true }), {
    world: { ...LOCAL, docs: DOCS },
    env: { ...LOCAL_ENV, BRAVE_SEARCH_API_KEY: "brave-key" },
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 16_384 }, { tools: false }),
    replies: [streamedReply(["Hello!"])],
  });
  await readEvents(res);
  assertEquals(provider.calls.map((c) => [c.stream, c.tools]), [[true, undefined]]);
  const system = String(provider.calls[0].messages[0].content);
  assert(system.includes("their full text is not available in this chat"), system);
  assert(!system.includes("read_imported_document") && !system.includes("# WEB SEARCH"), system);
});

Deno.test("local model: a document read by the tool is cut to the room the window leaves, and the answer fits", async () => {
  const longNotes = [{ ...DOCS[0], extracted_text: "w".repeat(60_000) }];
  const { res, provider } = await send(post(ASK), {
    world: { ...LOCAL, docs: longNotes },
    env: LOCAL_ENV,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [readDoc(), jsonReply({ content: "" }), streamedReply(["From your notes."])],
  });
  assertEquals((await readEvents(res)).at(-1)?.done, true);
  const result = String(provider.calls[1].messages.find((m) => m.role === "tool")?.content);
  assert(result.startsWith('Document "notes.md":\n\nwww') && result.endsWith(RESULT_CUT_NOTE), result.slice(-100));
  for (const call of provider.calls) assert(fitsWindow(call, 8_192), `call of ${call.max_tokens} tokens`);
  assert(provider.calls[2].max_tokens >= 900, String(provider.calls[2].max_tokens));
});

/** n saved messages of ~1,800 characters (~600 tokens each), a minute apart. */
const longThread = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `${i + 1} ${"m".repeat(1_800)}`,
    created_at: `2026-11-10T10:${String(i).padStart(2, "0")}:00.000Z`,
  }));

Deno.test("local model: a thread too long for the window gets one early memory refresh, then the reply", async () => {
  const { res, provider } = await send(post(ASK), {
    world: { ...LOCAL, messages: longThread(15) },
    env: LOCAL_ENV,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [jsonReply({ content: "1. Direction: tides." }), streamedReply(["Hello!"])],
  });
  assertEquals((await readEvents(res)).at(-1)?.done, true);
  // The summarizer ran first, then the reply, with the new memory and a shorter window.
  assertEquals(provider.calls.map((c) => c.stream === true), [false, true]);
  assert(String(provider.calls[0].messages[1].content).startsWith("PREVIOUS MEMORY:"));
  const reply = provider.calls[1];
  assert(String(reply.messages[1].content).includes("1. Direction: tides."), "the memory is injected");
  const history = reply.messages.slice(2, -1);
  assert(history.length < 15, String(history.length));
  assert(fitsWindow(reply, 8_192));
});

/** A summarizer's answer of ~1,500 characters (~500 tokens in the next prompts). */
const longSummary = () => jsonReply({ content: `1. Direction: ${"d".repeat(1_500)}` });

Deno.test("local model: a backlog bigger than one refresh gets a second one, then the reply", async () => {
  const { res, provider } = await send(post(ASK), {
    world: { ...LOCAL, messages: longThread(15) },
    env: LOCAL_ENV,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [longSummary(), longSummary(), streamedReply(["Hello!"])],
  });
  assertEquals((await readEvents(res)).at(-1)?.done, true);
  assertEquals(provider.calls.map((c) => c.stream === true), [false, false, true]);
  // The second pass started from the first one's memory.
  assert(String(provider.calls[1].messages[1].content).includes("dddd"));
  assert(fitsWindow(provider.calls[2], 8_192));
});

Deno.test("local model: at most 3 early refreshes, then the 400; no reply call", async () => {
  const { res, provider } = await send(post(ASK), {
    world: { ...LOCAL, messages: longThread(40) },
    env: LOCAL_ENV,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [longSummary(), longSummary(), longSummary()],
  });
  assertEquals(res.status, 400);
  assert(String((await res.json()).error).startsWith("Too long for sylou-nemo-16k:"));
  assertEquals(provider.calls.length, 3);
});

Deno.test("local model: still too long after the early refresh: 400, start a new thread; no reply call, nothing saved", async () => {
  const { res, backend, provider } = await send(post({ ...ASK, message: "q".repeat(30_000) }), {
    world: { ...LOCAL, messages: longThread(2) },
    env: LOCAL_ENV,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
    replies: [jsonReply({ content: "1. Direction: tides." })],
  });
  assertEquals(res.status, 400);
  assertEquals(await res.json(), {
    error: "Too long for sylou-nemo-16k: this conversation needs more room than its window of 8,192 tokens leaves. " +
      "Start a new thread, or pick a model with a larger window in Settings.",
  });
  assertEquals(provider.calls.length, 1); // the summarizer only
  assertEquals(writes(backend.calls).filter(([, table]) => table === "chat_messages"), []);
});

Deno.test("local model: too long with no history to summarize: 400 at once, no provider call", async () => {
  const { res, provider } = await send(post({ ...ASK, message: "q".repeat(30_000) }), {
    world: LOCAL,
    env: LOCAL_ENV,
    localModels: fakeLocalModels({ [LOCAL_MODEL]: 8_192 }),
  });
  assertEquals(res.status, 400);
  assertEquals(provider.calls.length, 0);
});
