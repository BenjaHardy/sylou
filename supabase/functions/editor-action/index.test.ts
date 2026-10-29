// editor-action/index.test.ts — the editor-action handler over HTTP: the
// model a selection rewrite runs on.
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
  post,
  UNLISTED_MODEL,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const MODEL = "mistral-small-2603";
const REWRITE = { project_id: "p-1", action_type: "rewrite", selected_text: "The tide came in.", stream: true };

/** Project p-1, visible to user u-1, with no favourite documents. */
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
        return { data: { id: "p-1" }, error: null };
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

// The rewrite call fails, so the request ends before a stream opens and
// nothing is saved.
const failedRewrite = () => Response.json({ message: "Overloaded" }, { status: 503 });

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
