// context-prompt/index.test.ts — the context-prompt handler over HTTP: the
// model its two calls run on (the writing summary, then the reply).
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DEFAULT_CHAT_MODEL } from "../_shared/_models.ts";
import {
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeEnv,
  fakeProvider,
  importHandler,
  jsonReply,
  post,
  UNLISTED_MODEL,
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

/** Project p-1 and its thread t-1, visible to user u-1: no writing, summary,
 *  memory, history or documents yet. */
function world(profile: Record<string, unknown>) {
  return (call: DbCall): DbResult | undefined => {
    switch (`${call.client} ${call.target}`) {
      case "user profiles":
        return {
          data: {
            tokens_used_this_period: 100,
            monthly_token_budget: 10_000,
            preferred_chat_model: MODEL,
            preferred_chat_reasoning: null,
            ...profile,
          },
          error: null,
        };
      case "user projects":
        return { data: { id: "p-1", tutor_mode: false, language: "English", template: "general" }, error: null };
      case "user chat_threads":
        return { data: { id: "t-1" }, error: null };
    }
    return undefined;
  };
}

async function send(
  req: Request,
  opts: { profile?: Record<string, unknown>; replies?: Response[]; env?: Record<string, string | undefined> } = {},
) {
  const backend = fakeBackend({ user: { id: "u-1" }, respond: world(opts.profile ?? {}) });
  const provider = fakeProvider(...(opts.replies ?? []));
  const res = await handler(req, {
    env: fakeEnv(opts.env),
    createClient: backend.createClient,
    callLLM: provider.callLLM,
  });
  return { res, backend, provider };
}

// The summary call answers and the reply call fails, so the request ends
// before a stream opens and nothing is saved.
const summaryThenFailedReply = () => [
  jsonReply({ content: "The writing so far: one sentence about the tide." }),
  Response.json({ message: "Overloaded" }, { status: 503 }),
];

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
