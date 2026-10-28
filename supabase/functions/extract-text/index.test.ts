// extract-text/index.test.ts — the extract-text handler over HTTP: the
// model an imported document's summary runs on.
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
  writes,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const MODEL = "mistral-small-2603";
const IMPORT = { file_path: "u-1/notes.txt", project_id: "p-1", document_id: "d-1" };
// Over the 500-character threshold, so the document gets an AI summary.
const NOTES = "Field notes on the estuary. ".repeat(30);
const SUMMARY = "Notes on the estuary.";

/** User u-1's document d-1 in project p-1, a text file in storage. */
function world(profile: Record<string, unknown>) {
  return (call: DbCall): DbResult | undefined => {
    switch (`${call.client} ${call.target}`) {
      case "user imported_documents":
        return { data: { id: "d-1", project_id: "p-1" }, error: null };
      case "admin storage:imports":
        return { data: new Blob([NOTES]), error: null };
      case "user profiles":
        return { data: { preferred_chat_model: MODEL, ...profile }, error: null };
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

const usageRow = (backend: ReturnType<typeof fakeBackend>) =>
  writes(backend.calls).find(([, table]) => table === "token_usage")?.[2] as Record<string, unknown> | undefined;

Deno.test("the summary runs on the saved model when it is listed, and the usage row names it", async () => {
  const { res, backend, provider } = await send(post(IMPORT), { replies: [jsonReply({ content: SUMMARY })] });
  assertEquals(await res.json(), { success: true, text_length: NOTES.length, summary_length: SUMMARY.length });
  assertEquals(provider.calls.map((c) => c.model), [MODEL]);
  assertEquals(usageRow(backend)?.model_used, MODEL);
});

Deno.test("a saved model off the allowlist: the summary runs on the default model, and the usage row names it", async () => {
  const { res, backend, provider } = await send(post(IMPORT), {
    profile: { preferred_chat_model: UNLISTED_MODEL },
    env: { ANTHROPIC_API_KEY: "anthropic-key" },
    replies: [jsonReply({ content: SUMMARY })],
  });
  assertEquals(await res.json(), { success: true, text_length: NOTES.length, summary_length: SUMMARY.length });
  assertEquals(provider.calls.map((c) => c.model), [DEFAULT_CHAT_MODEL]);
  assertEquals(usageRow(backend)?.model_used, DEFAULT_CHAT_MODEL);
});
