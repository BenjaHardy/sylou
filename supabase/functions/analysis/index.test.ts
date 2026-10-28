// analysis/index.test.ts — the analysis handler over HTTP: the model a FLOW
// analysis runs on.
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DEFAULT_FLOW_MODEL } from "../_shared/_models.ts";
import {
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeEnv,
  fakeProvider,
  importHandler,
  post,
  UNLISTED_MODEL,
  writes,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const MODEL = "mistral-small-2603";
const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

/** User u-1's general project with one paragraph of writing and no budget
 *  cap; no chat, provenance, editor activity or documents. */
function world(profile: Record<string, unknown>) {
  return (call: DbCall): DbResult | undefined => {
    switch (`${call.client} ${call.target}`) {
      case "user projects":
        return {
          data: { id: PROJECT_ID, language: "English", tutor_mode: false, name: "Estuary", template: "general" },
          error: null,
        };
      case "user profiles":
        return {
          data: { tokens_used_this_period: 0, monthly_token_budget: null, preferred_flow_model: MODEL, ...profile },
          error: null,
        };
      case "user writing_content":
        return { data: { content: "<p>The tide came in over the flats.</p>" }, error: null };
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
