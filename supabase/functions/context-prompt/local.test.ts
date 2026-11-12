// context-prompt/local.test.ts — Ask/Propose sized to a local model's
// window: the summary call's room, the reply call's favourites, tools and
// room, the check before the summary call, and the refusals.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { estimatePromptTokens } from "../_shared/_fit.ts";
import type { callLLM, LLMMessage } from "../_shared/_llm.ts";
import { localMemoryProfile } from "../_shared/_conversation_memory.ts";
import type { FavouriteDoc } from "../_shared/_favourites.ts";
import { buildDocumentTool, buildWebSearchTool } from "../_shared/_tools.ts";
import { buildResponsePrompt, CLASSIC_MODE_SYSTEM_PROMPT } from "./prompts.ts";
import {
  answerTooLongError,
  fitLocalConversation,
  fitLocalFinal,
  fitLocalReply,
  fitLocalSummary,
  LOCAL_ANSWER_MIN_REPLY,
  type ReplyPromptParts,
  writingTooLongError,
} from "./local.ts";

const MODEL = "ollama/sylou-ministral-8k";

const favourite = (id: string, chars: number, summaryChars = 0): FavouriteDoc => ({
  id,
  file_name: `${id}.md`,
  extracted_text: `${id} text ${"x".repeat(chars)}`,
  summary: `About ${id}.${"s".repeat(summaryChars)}`,
});

/** The reply call's parts as the handler builds them: an Ask on a short
 *  conversation, no documents unless given. */
function parts(over: {
  favourites?: FavouriteDoc[];
  hasNonFavDocs?: boolean;
  canUseTools?: boolean;
  webSearch?: boolean;
  history?: { role: string; content: string }[];
} = {}): ReplyPromptParts {
  const hasNonFavDocs = over.hasNonFavDocs ?? false;
  const canUseTools = over.canUseTools ?? true;
  return {
    messages: (favBlock, writingSummary, memory, history) =>
      buildResponsePrompt(
        CLASSIC_MODE_SYSTEM_PROMPT + favBlock,
        writingSummary,
        "The tide came in.",
        "Is this sentence clear?",
        "editor",
        history,
        "ask",
        "English",
        memory?.summary_text ?? null,
      ),
    tools: (summaries) => [
      ...(canUseTools && (hasNonFavDocs || summaries) ? [buildDocumentTool()] : []),
      ...(over.webSearch ? [buildWebSearchTool()] : []),
    ],
    favourites: over.favourites ?? [],
    hasNonFavDocs,
    canUseTools,
    memory: null,
    history: over.history ?? [{ role: "user", content: "Earlier question." }, { role: "assistant", content: "Earlier answer." }],
  };
}

const system = (fit: ReturnType<typeof fitLocalReply>) => String(fit?.messages[0].content);

/** A provider stand-in for checks that must not call one. */
const noCall = (() => {
  throw new Error("no provider call expected");
}) as unknown as typeof callLLM;

Deno.test("the summary call: its full budget when the writing fits, less down to its minimum, then the refusal", () => {
  const call = (chars: number) => [{ role: "system", content: "w".repeat(chars) }];
  assertEquals(fitLocalSummary(MODEL, 8_192, call(6_000), 2_000), { maxTokens: 2_000 });
  // 8 + 6,928 tokens of prompt leave 1,000 of the window's 8,192, less the 256 margin.
  assertEquals(fitLocalSummary(MODEL, 8_192, call(20_784), 2_000), { maxTokens: 1_000 });
  assertEquals(fitLocalSummary(MODEL, 8_192, call(22_000), 2_000), { error: writingTooLongError(MODEL, 8_192) });
});

Deno.test("the reply call: the full reply budget beside a short conversation, and no tools without documents or web search", () => {
  const fit = fitLocalReply(parts(), "A summary of the writing.", 16_384, 4_000);
  assertEquals(fit?.maxTokens, 4_000);
  assertEquals(fit?.tools, []);
  assert(system(fit).includes("relevant to their request:\nA summary of the writing.\n"), system(fit));
});

Deno.test("favourites: whole while a full-length reply fits beside them, the others as summaries the tool can read", () => {
  const small = favourite("style", 2_000);
  const big = favourite("thesis", 60_000);
  const fit = fitLocalReply(parts({ favourites: [small, big] }), "A summary.", 16_384, 4_000);
  const prompt = system(fit);
  assert(prompt.includes("=== style.md ===\n\nstyle text"), "the small favourite goes in whole");
  assert(!prompt.includes("thesis text"), "the big one does not");
  assert(prompt.includes('- Document: "thesis.md" (ID: thesis)\n  Summary: About thesis.'), prompt);
  assertEquals(fit?.tools.map((t) => t.function.name), ["read_imported_document"]);
  // Beside the favourites, the reply keeps its full budget.
  assertEquals(fit?.maxTokens, 4_000);
  assert(estimatePromptTokens(fit!.messages as LLMMessage[], fit!.tools) + 4_000 <= 16_384 - 256);
});

Deno.test("favourites, a model that cannot call tools: summaries only, no tool offered or named", () => {
  const fit = fitLocalReply(parts({ canUseTools: false, favourites: [favourite("thesis", 60_000)] }), "A summary.", 16_384, 4_000);
  assertEquals(fit?.tools, []);
  assert(system(fit).includes("Only their summaries are below."));
  assert(!system(fit).includes("read_imported_document"), system(fit));
});

Deno.test("web search is offered beside the document tool when on, and counted in the prompt", () => {
  const fit = fitLocalReply(parts({ hasNonFavDocs: true, webSearch: true }), "A summary.", 16_384, 4_000);
  assertEquals(fit?.tools.map((t) => t.function.name), ["read_imported_document", "web_search"]);
  const withoutTools = estimatePromptTokens(fit!.messages as LLMMessage[]);
  assert(estimatePromptTokens(fit!.messages as LLMMessage[], fit!.tools) > withoutTools + 100);
});

Deno.test("a long summary takes the reply's room down to its minimum, then does not fit", () => {
  const tight = fitLocalReply(parts(), "s".repeat(15_000), 8_192, 4_000); // ~5,000 tokens
  assert(tight && tight.maxTokens >= LOCAL_ANSWER_MIN_REPLY && tight.maxTokens < 4_000, String(tight?.maxTokens));
  assertEquals(fitLocalReply(parts(), "s".repeat(19_500), 8_192, 4_000), null); // ~6,500 tokens
});

Deno.test("the check before the summary call: a conversation that leaves room runs no refresh", async () => {
  const p = parts();
  const fitted = await fitLocalConversation({
    parts: p,
    contextTokens: 8_192,
    profile: localMemoryProfile(8_192),
    userClient: {},
    admin: {},
    threadId: "t-1",
    model: MODEL,
    userId: "u-1",
    llm: noCall,
  });
  assert(fitted === p, "the parts come back as they were");
});

Deno.test("the check before the summary call: too long with no conversation to fold in is the refusal at once", async () => {
  // Every favourite counted as its summary: ten summaries of 3,000 characters fill an 8k window.
  const favourites = Array.from({ length: 10 }, (_, i) => favourite(`f${i}`, 10, 3_000));
  const fitted = await fitLocalConversation({
    parts: parts({ favourites, history: [] }),
    contextTokens: 8_192,
    profile: localMemoryProfile(8_192),
    userClient: {},
    admin: {},
    threadId: "t-1",
    model: MODEL,
    userId: "u-1",
    llm: noCall,
  });
  assertEquals(fitted, { error: answerTooLongError(MODEL, 8_192) });
});

Deno.test("the reply after a tool round takes whatever room is left; no room is the refusal", () => {
  const call = { messages: [{ role: "user" as const, content: "x".repeat(3_000) }] }; // 1,008 tokens
  assertEquals(fitLocalFinal(MODEL, 2_000, call, 4_000), { maxTokens: 736 }); // 2,000 − 256 − 1,008
  assertEquals(fitLocalFinal(MODEL, 1_200, call, 4_000), { error: answerTooLongError(MODEL, 1_200) });
});

Deno.test("the refusals name the model and its window, and say what to do, in under 200 characters", () => {
  const writing = writingTooLongError(MODEL, 8_192);
  assertEquals(
    writing,
    "Too long for sylou-ministral-8k: Ask and Propose read your whole writing and the selection, which need more " +
      "room than its window of 8,192 tokens leaves. Pick a model with a larger window in Settings.",
  );
  const answer = answerTooLongError(MODEL, 8_192);
  assertEquals(
    answer,
    "Too long for sylou-ministral-8k: this request needs more room than its window of 8,192 tokens leaves. " +
      "Select less text, start a new thread, or pick a model with a larger window in Settings.",
  );
  for (const error of [writing, answer]) assert(error.length < 200, String(error.length));
});
