// context-prompt/local.ts — Ask/Propose sized to a local model's window.
// Ollama drops what overflows the window without an error (_fit.ts), so both
// calls are measured before they run. On a local model the writing-summary
// call (#1) gets no stored summary: it writes a fresh summary for this
// request, so its size depends only on the writing, the selection and the
// request. Before that call runs, the reply call (#2) must leave room for a
// summary and a reply of their minimum sizes, after up to three early memory
// refreshes; after it, the reply call is sized with the summary written, a
// favourite document going in whole only while a full-length reply still fits
// beside it, the others as their summaries (as in chat). A call that does not
// fit is refused with a message: never cut, never sent to a cloud model.

import type { callLLM, LLMMessage, LLMTool } from "../_shared/_llm.ts";
import { estimatePromptTokens, estimateTokens, fitReply, roomLeft } from "../_shared/_fit.ts";
import { ollamaName } from "../_shared/_ollama.ts";
import { buildSummarizedFavBlock, type FavouriteDoc, splitFavourites } from "../_shared/_favourites.ts";
import {
  type ConversationMemoryRow,
  fetchConversationMemory,
  fetchVerbatimWindow,
  maybeRefreshConversationMemory,
  type MemoryProfile,
  type VerbatimMessage,
} from "../_shared/_conversation_memory.ts";
import { buildContextFavBlock } from "./prompts.ts";

/** A message as the prompt builders (prompts.ts) write it. */
type PromptMessage = { role: string; content: string };

const promptTokens = (messages: PromptMessage[], tools: LLMTool[] = []) =>
  estimatePromptTokens(messages as LLMMessage[], tools);

/** The least the writing-summary call gets: its prompt asks for under 300
 *  words, about 600 tokens by the estimate (_fit.ts). */
export const LOCAL_SUMMARY_MIN_REPLY = 600;

/** The least an Ask or Propose reply gets beside its prompt (chat's minimum). */
export const LOCAL_ANSWER_MIN_REPLY = 1_000;

/** Early memory refreshes a request may run when its conversation leaves no
 *  room for the reply, before it refuses (chat's number). */
export const LOCAL_EARLY_REFRESHES = 3;

/** What the reply call's prompt is made of. */
export interface ReplyPromptParts {
  /** The reply call's messages for a favourites block, a writing summary and
   *  a conversation. */
  messages: (
    favBlock: string,
    writingSummary: string,
    memory: ConversationMemoryRow | null,
    history: VerbatimMessage[],
  ) => PromptMessage[];
  /** Its tools; `summaries`: a favourite is given as its summary, whose full
   *  text the document tool can read. */
  tools: (summaries: boolean) => LLMTool[];
  favourites: FavouriteDoc[];
  hasNonFavDocs: boolean;
  /** The model can call tools. */
  canUseTools: boolean;
  memory: ConversationMemoryRow | null;
  history: VerbatimMessage[];
}

/** max_tokens for the writing-summary call, or the 400 answer when the
 *  writing does not fit beside the summary's minimum. */
export function fitLocalSummary(
  model: string,
  contextTokens: number,
  messages: PromptMessage[],
  budget: number,
): { maxTokens: number } | { error: string } {
  const maxTokens = fitReply(contextTokens, promptTokens(messages), budget, LOCAL_SUMMARY_MIN_REPLY);
  return maxTokens === null ? { error: writingTooLongError(model, contextTokens) } : { maxTokens };
}

/** Whether the reply call, every favourite given as its summary, leaves room
 *  for a summary and a reply of their minimum sizes. */
function answerCanFit(parts: ReplyPromptParts, contextTokens: number): boolean {
  const { favourites, canUseTools, memory, history } = parts;
  const favBlock = favourites.length > 0 ? buildSummarizedFavBlock(favourites, canUseTools) : "";
  const prompt = promptTokens(parts.messages(favBlock, "", memory, history), parts.tools(favourites.length > 0));
  return roomLeft(contextTokens, prompt + LOCAL_SUMMARY_MIN_REPLY, LOCAL_ANSWER_MIN_REPLY) >= 0;
}

/** The reply call's conversation, checked before the summary call runs: after
 *  up to LOCAL_EARLY_REFRESHES early memory refreshes when it leaves no room —
 *  each one shortens the verbatim window; else the 400 answer. */
export async function fitLocalConversation(opts: {
  parts: ReplyPromptParts;
  contextTokens: number;
  profile: MemoryProfile;
  /** The caller's client, which re-reads the memory and the window under RLS. */
  userClient: unknown;
  /** The service-role client, which writes the memory. */
  admin: unknown;
  threadId: string;
  model: string;
  userId: string;
  llm: typeof callLLM;
}): Promise<ReplyPromptParts | { error: string }> {
  const { contextTokens, profile, userClient, threadId, model } = opts;
  let parts = opts.parts;
  let fits = answerCanFit(parts, contextTokens);
  for (let pass = 1; !fits && parts.history.length > 0 && pass <= LOCAL_EARLY_REFRESHES; pass++) {
    console.log(`[context-prompt] request too long for ${model}: early memory refresh ${pass} of ${LOCAL_EARLY_REFRESHES}`);
    const refreshed = await maybeRefreshConversationMemory({
      admin: opts.admin,
      threadId,
      model,
      userId: opts.userId,
      overBudget: false,
      logTag: "[context-prompt]",
      profile,
      force: true,
      llm: opts.llm,
    });
    if (!refreshed) break; // nothing left to fold in, or the summarizer failed
    const memory = await fetchConversationMemory(userClient, threadId);
    const history = await fetchVerbatimWindow(userClient, threadId, memory, profile);
    parts = { ...parts, memory, history };
    fits = answerCanFit(parts, contextTokens);
  }
  return fits ? parts : { error: answerTooLongError(model, contextTokens) };
}

/** The reply call's messages, tools and max_tokens with the summary the first
 *  call wrote; null when the prompt leaves the reply less than its minimum. */
export function fitLocalReply(
  parts: ReplyPromptParts,
  writingSummary: string,
  contextTokens: number,
  replyBudget: number,
): { messages: PromptMessage[]; tools: LLMTool[]; maxTokens: number } | null {
  const { favourites, hasNonFavDocs, canUseTools, memory, history } = parts;
  const wholeBlock = (docs: FavouriteDoc[]) => buildContextFavBlock(docs, hasNonFavDocs && canUseTools);

  // The room for whole favourites: what a full-length reply leaves beside the
  // rest of the prompt, the block's header and every favourite's summary.
  const rest = promptTokens(parts.messages("", writingSummary, memory, history), parts.tools(favourites.length > 0));
  const reserved = favourites.length > 0 ? estimateTokens(wholeBlock([]) + buildSummarizedFavBlock(favourites, canUseTools)) : 0;
  const { whole, summarized } = splitFavourites(favourites, roomLeft(contextTokens, rest + reserved, replyBudget));

  const favBlock = (whole.length > 0 ? wholeBlock(whole) : "") +
    (summarized.length > 0 ? buildSummarizedFavBlock(summarized, canUseTools) : "");
  const messages = parts.messages(favBlock, writingSummary, memory, history);
  const tools = parts.tools(summarized.length > 0);
  const maxTokens = fitReply(contextTokens, promptTokens(messages, tools), replyBudget, LOCAL_ANSWER_MIN_REPLY);
  return maxTokens === null ? null : { messages, tools, maxTokens };
}

/** max_tokens for the reply after a tool round: whatever room the window has
 *  left. The loop kept the reply its minimum, less its own short notes. */
export function fitLocalFinal(
  model: string,
  contextTokens: number,
  call: { messages: LLMMessage[]; tools?: LLMTool[] },
  budget: number,
): { maxTokens: number } | { error: string } {
  const maxTokens = fitReply(contextTokens, estimatePromptTokens(call.messages, call.tools), budget, 1);
  return maxTokens === null ? { error: answerTooLongError(model, contextTokens) } : { maxTokens };
}

/** The 400 answer when the writing does not fit the summary call. */
export function writingTooLongError(model: string, contextTokens: number): string {
  return `Too long for ${ollamaName(model)}: Ask and Propose read your whole writing and the selection, which need ` +
    `more room than its window of ${contextTokens.toLocaleString("en-US")} tokens leaves. ` +
    "Pick a model with a larger window in Settings.";
}

/** The 400 answer when the reply call does not fit. */
export function answerTooLongError(model: string, contextTokens: number): string {
  return `Too long for ${ollamaName(model)}: this request needs more room than its window of ` +
    `${contextTokens.toLocaleString("en-US")} tokens leaves. Select less text, start a new thread, ` +
    "or pick a model with a larger window in Settings.";
}
