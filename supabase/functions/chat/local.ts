// chat/local.ts — a chat request sized to a local model's window. Ollama
// drops what overflows the window without an error (_fit.ts), so the prompt
// is measured before the first call: a favourite document goes in whole
// only while a full-length reply still fits beside it, the others as their
// summaries, and the whole prompt must leave the reply its minimum. A prompt
// still too long gets early memory refreshes, then a 400: never a silent cut.

import type { callLLM, LLMMessage, LLMTool } from "../_shared/_llm.ts";
import { estimatePromptTokens, estimateTokens, fitReply, roomLeft } from "../_shared/_fit.ts";
import { ollamaName } from "../_shared/_ollama.ts";
import {
  type ConversationMemoryRow,
  fetchConversationMemory,
  fetchVerbatimWindow,
  maybeRefreshConversationMemory,
  type MemoryProfile,
  type VerbatimMessage,
} from "../_shared/_conversation_memory.ts";
import { buildSummarizedFavBlock, type FavouriteDoc, splitFavourites } from "../_shared/_favourites.ts";
import { buildChatMessages, buildFavBlock, chatTools } from "./context.ts";

/** The least a chat reply gets beside its prompt: a few paragraphs. */
export const LOCAL_CHAT_MIN_REPLY = 1_000;

/** Early memory refreshes a request may run on a prompt too long for the
 *  window, each folding the next slab of messages into the memory, before
 *  it refuses: a long thread moved from a cloud model can need several. */
export const LOCAL_EARLY_REFRESHES = 3;

/** What a chat call's prompt is made of. */
export interface ChatPromptParts {
  /** The system prompt before the favourites block, and after it. */
  head: string;
  tail: string;
  favourites: FavouriteDoc[];
  hasNonFavDocs: boolean;
  /** The model can call tools: the document tool, and web search when on. */
  canUseTools: boolean;
  webSearchActive: boolean;
  memory: ConversationMemoryRow | null;
  history: VerbatimMessage[];
  message: string;
}

/** The call's messages, tools and max_tokens within the window; null when
 *  the prompt leaves the reply less than its minimum. */
export function fitLocalChat(
  parts: ChatPromptParts,
  contextTokens: number,
  replyBudget: number,
): { messages: LLMMessage[]; tools: LLMTool[]; maxTokens: number } | null {
  const { head, tail, favourites, hasNonFavDocs, canUseTools, memory, history, message } = parts;
  // A favourite given as its summary can still be read with the document tool.
  const toolsFor = (summaries: boolean) => chatTools(canUseTools && (hasNonFavDocs || summaries), parts.webSearchActive);
  const wholeBlock = (docs: FavouriteDoc[]) => buildFavBlock(docs, hasNonFavDocs && canUseTools);

  // The room for whole favourites: what a full-length reply leaves beside the
  // rest of the prompt, the block's header and every favourite's summary.
  const rest = estimatePromptTokens(buildChatMessages(head + tail, memory, history, message), toolsFor(favourites.length > 0));
  const reserved = favourites.length > 0 ? estimateTokens(wholeBlock([]) + buildSummarizedFavBlock(favourites, canUseTools)) : 0;
  const { whole, summarized } = splitFavourites(favourites, roomLeft(contextTokens, rest + reserved, replyBudget));

  const favBlock = (whole.length > 0 ? wholeBlock(whole) : "") +
    (summarized.length > 0 ? buildSummarizedFavBlock(summarized, canUseTools) : "");
  const messages = buildChatMessages(head + favBlock + tail, memory, history, message);
  const tools = toolsFor(summarized.length > 0);
  const maxTokens = fitReply(contextTokens, estimatePromptTokens(messages, tools), replyBudget, LOCAL_CHAT_MIN_REPLY);
  return maxTokens === null ? null : { messages, tools, maxTokens };
}

/** The chat call within the window, after up to LOCAL_EARLY_REFRESHES early
 *  memory refreshes when the prompt is too long — each one shortens the
 *  verbatim window; else the 400 answer. */
export async function fitLocalChatRequest(opts: {
  parts: ChatPromptParts;
  contextTokens: number;
  replyBudget: number;
  profile: MemoryProfile;
  /** The caller's client, which re-reads the memory and the window under RLS. */
  userClient: unknown;
  /** The service-role client, which writes the memory. */
  admin: unknown;
  threadId: string;
  model: string;
  userId: string;
  llm: typeof callLLM;
}): Promise<{ messages: LLMMessage[]; tools: LLMTool[]; maxTokens: number } | { error: string; status: number }> {
  const { contextTokens, replyBudget, profile, userClient, threadId, model } = opts;
  let parts = opts.parts;
  let fitted = fitLocalChat(parts, contextTokens, replyBudget);
  for (let pass = 1; !fitted && parts.history.length > 0 && pass <= LOCAL_EARLY_REFRESHES; pass++) {
    console.log(`[chat] prompt too long for ${model}: early memory refresh ${pass} of ${LOCAL_EARLY_REFRESHES}`);
    const refreshed = await maybeRefreshConversationMemory({
      admin: opts.admin,
      threadId,
      model,
      userId: opts.userId,
      overBudget: false,
      logTag: "[chat]",
      profile,
      force: true,
      llm: opts.llm,
    });
    if (!refreshed) break; // nothing left to fold in, or the summarizer failed
    const memory = await fetchConversationMemory(userClient, threadId);
    const history = await fetchVerbatimWindow(userClient, threadId, memory, profile);
    parts = { ...parts, memory, history };
    fitted = fitLocalChat(parts, contextTokens, replyBudget);
  }
  return fitted ?? { error: chatTooLongError(model, contextTokens), status: 400 };
}

/** max_tokens for the reply after a tool round: whatever room the window has
 *  left. The loop kept the reply its minimum, less its own short notes. */
export function fitFinalReply(
  model: string,
  contextTokens: number,
  call: { messages: LLMMessage[]; tools?: LLMTool[] },
  budget: number,
): { maxTokens: number } | { error: string } {
  const maxTokens = fitReply(contextTokens, estimatePromptTokens(call.messages, call.tools), budget, 1);
  return maxTokens === null ? { error: chatTooLongError(model, contextTokens) } : { maxTokens };
}

/** The 400 answer when a chat prompt does not fit, even after the early refreshes. */
export function chatTooLongError(model: string, contextTokens: number): string {
  return `Too long for ${ollamaName(model)}: this conversation needs more room than its window of ` +
    `${contextTokens.toLocaleString("en-US")} tokens leaves. Start a new thread, or pick a model with a larger window in Settings.`;
}
