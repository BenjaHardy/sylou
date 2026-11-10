// chat/local.test.ts — a chat prompt sized to a local model's window: which
// favourites go in whole, the tools offered, and the reply's room.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { estimatePromptTokens } from "../_shared/_fit.ts";
import { type ChatPromptParts, chatTooLongError, fitLocalChat, LOCAL_CHAT_MIN_REPLY } from "./local.ts";

const favourite = (id: string, chars: number) => ({
  id,
  file_name: `${id}.md`,
  extracted_text: `${id} text ${"x".repeat(chars)}`,
  summary: `About ${id}.`,
});

const PARTS: ChatPromptParts = {
  head: "You are a writing assistant.",
  tail: "",
  favourites: [],
  hasNonFavDocs: false,
  canUseTools: true,
  webSearchActive: false,
  memory: null,
  history: [{ role: "user", content: "Earlier question." }, { role: "assistant", content: "Earlier answer." }],
  message: "Next question?",
};

const system = (fit: ReturnType<typeof fitLocalChat>) => String(fit?.messages[0].content);

Deno.test("a prompt that fits: the full reply budget, and no tools without documents or web search", () => {
  const fit = fitLocalChat(PARTS, 16_384, 4_000);
  assertEquals(fit?.maxTokens, 4_000);
  assertEquals(fit?.tools, []);
  assertEquals(fit?.messages.at(-1), { role: "user", content: "Next question?" });
});

Deno.test("favourites: whole while a full-length reply fits beside them, the others as summaries the tool can read", () => {
  const small = favourite("style", 2_000);
  const big = favourite("thesis", 60_000);
  const fit = fitLocalChat({ ...PARTS, favourites: [small, big] }, 16_384, 4_000);
  const prompt = system(fit);
  assert(prompt.includes("=== style.md ===\n\nstyle text"), "the small favourite goes in whole");
  assert(!prompt.includes("thesis text"), "the big one does not");
  assert(prompt.includes('- Document: "thesis.md" (ID: thesis)\n  Summary: About thesis.'), prompt);
  assertEquals(fit?.tools.map((t) => t.function.name), ["read_imported_document"]);
  // Beside the favourites, the reply keeps its full budget.
  assertEquals(fit?.maxTokens, 4_000);
  assert(estimatePromptTokens(fit!.messages, fit!.tools) + 4_000 <= 16_384 - 256);
});

Deno.test("favourites, a model that cannot call tools: summaries only, no tool offered or named", () => {
  const fit = fitLocalChat({ ...PARTS, canUseTools: false, favourites: [favourite("thesis", 60_000)] }, 16_384, 4_000);
  assertEquals(fit?.tools, []);
  assert(system(fit).includes("Only their summaries are below."));
  assert(!system(fit).includes("read_imported_document tool when"), system(fit));
});

Deno.test("web search is offered beside the document tool when on", () => {
  const fit = fitLocalChat({ ...PARTS, hasNonFavDocs: true, webSearchActive: true }, 16_384, 4_000);
  assertEquals(fit?.tools.map((t) => t.function.name), ["read_imported_document", "web_search"]);
});

Deno.test("a long conversation takes the reply's room down to its minimum, then does not fit", () => {
  const history = [{ role: "assistant", content: "y".repeat(19_000) }]; // ~6,334 tokens
  const tight = fitLocalChat({ ...PARTS, history }, 8_192, 4_000);
  assert(tight && tight.maxTokens >= LOCAL_CHAT_MIN_REPLY && tight.maxTokens < 4_000, String(tight?.maxTokens));
  const tooLong = fitLocalChat({ ...PARTS, history: [{ role: "assistant", content: "y".repeat(21_000) }] }, 8_192, 4_000);
  assertEquals(tooLong, null);
});

Deno.test("the refusal names the model and its window, and says what to do, in under 200 characters", () => {
  const error = chatTooLongError("ollama/sylou-ministral-8k", 8_192);
  assertEquals(
    error,
    "Too long for sylou-ministral-8k: this conversation needs more room than its window of 8,192 tokens leaves. " +
      "Start a new thread, or pick a model with a larger window in Settings.",
  );
  assert(error.length < 200, String(error.length)); // the chat shows 200 characters of an error
});
