// chat/local.ts — a chat request sized to a local model's window. Ollama
// drops what overflows the window without an error (_fit.ts), so the prompt
// is measured before the first call: a favourite document goes in whole
// only while a full-length reply still fits beside it, the others as their
// summaries, and the whole prompt must leave the reply its minimum.

import type { LLMMessage, LLMTool } from "../_shared/_llm.ts";
import { estimatePromptTokens, estimateTokens, fitReply, roomLeft } from "../_shared/_fit.ts";
import { ollamaName } from "../_shared/_ollama.ts";
import type { ConversationMemoryRow, VerbatimMessage } from "../_shared/_conversation_memory.ts";
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

/** The 400 answer when a chat prompt does not fit, even after a memory refresh. */
export function chatTooLongError(model: string, contextTokens: number): string {
  return `Too long for ${ollamaName(model)}: this conversation needs more room than its window of ` +
    `${contextTokens.toLocaleString("en-US")} tokens leaves. Start a new thread, or pick a model with a larger window in Settings.`;
}
