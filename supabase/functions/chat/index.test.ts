// chat/index.test.ts — the chat handler over HTTP: CORS, the guard sequence
// (token → profile → budget → request checks → thread visibility) and the
// SSE contract (phase / token / done, and the done that carries an error).
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { INPUT_LIMITS } from "../_shared/_models.ts";
import {
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
  /** The assistant-message insert fails. */
  failAssistantInsert?: boolean;
}

/** Thread t-1 in project p-1, visible to user u-1: no history, no memory,
 *  no documents unless given. */
function world(w: World) {
  let inserts = 0;
  return (call: DbCall): DbResult | undefined => {
    const first = call.steps[0]?.[0];
    const last = call.steps.at(-1)?.[0];
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
        return { data: { tutor_mode: false, template: "general" }, error: null };
      case "user chat_messages":
        return { data: [], error: null };
      case "admin imported_documents":
        return last === "maybeSingle"
          ? { data: { file_name: "notes.md", extracted_text: "The field notes." }, error: null }
          : { data: w.docs ?? [], error: null };
      case "admin chat_messages": {
        // The memory refresh's candidate read: too few to refresh.
        if (first !== "insert") return { data: [], error: null };
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
