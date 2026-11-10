// Sizing a call to a local model. Ollama drops what does not fit the
// model's context window without an error, so a call to a local model is
// measured first: the prompt's estimated tokens and room for the reply must
// fit the window, or the call does not run.

import type { LLMMessage, LLMTool } from "./_llm.ts";
import { type fetchLocalModelInfo, ollamaName } from "./_ollama.ts";

/** Tokens a chat template adds around each message (role markers, separators). */
const MESSAGE_OVERHEAD_TOKENS = 8;

/** The estimate's unit: UTF-8 bytes per token. */
export const BYTES_PER_TOKEN = 3;

/** A cautious token count: one token per 3 bytes of UTF-8. Prose in Latin
 *  scripts runs at about 4–5 characters a token; a CJK character takes 3
 *  bytes and about one token. */
export function estimateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / BYTES_PER_TOKEN);
}

/** The estimated tokens of a message list, with the tools offered beside it:
 *  the chat template renders the tool definitions and the assistant's tool
 *  calls into the prompt too. */
export function estimatePromptTokens(messages: LLMMessage[], tools: LLMTool[] = []): number {
  const toolTokens = tools.length > 0 ? estimateTokens(JSON.stringify(tools)) : 0;
  return messages.reduce((sum, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    const calls = m.tool_calls ? JSON.stringify(m.tool_calls) : "";
    return sum + MESSAGE_OVERHEAD_TOKENS + estimateTokens(text + calls);
  }, toolTokens);
}

/** Window kept free for text that tokenizes denser than the estimate. */
const WINDOW_MARGIN_TOKENS = 256;

/** The tokens a window has left beside a prompt and a reply of
 *  `replyTokens`, less the margin; negative when they do not fit. */
export function roomLeft(contextTokens: number, promptTokens: number, replyTokens: number): number {
  return contextTokens - WINDOW_MARGIN_TOKENS - promptTokens - replyTokens;
}

/** max_tokens for a reply beside its prompt in a window: the budget, or the
 *  room the window leaves (less a margin) when that is smaller; null when
 *  less than `minReply` is left. */
export function fitReply(contextTokens: number, promptTokens: number, budget: number, minReply: number): number | null {
  const room = roomLeft(contextTokens, promptTokens, 0);
  return room < minReply ? null : Math.min(budget, room);
}

/** `text` whole when its estimate fits `maxTokens`; else its start, cut
 *  between characters, followed by `note`, both within `maxTokens` (the note
 *  alone when the budget holds no more than it). */
export function cutToFit(text: string, maxTokens: number, note: string): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const bytes = new TextEncoder().encode(text);
  let end = Math.max(0, (maxTokens - estimateTokens(note)) * BYTES_PER_TOKEN);
  // A UTF-8 continuation byte (10xxxxxx) would split a character: cut before it.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return new TextDecoder().decode(bytes.subarray(0, end)) + note;
}

/** The 400 answer when a call does not fit a local model's window. */
export function tooLongError(model: string, contextTokens: number): string {
  return `Too long for ${ollamaName(model)}: the text, favourite documents included, needs more room ` +
    `than its window of ${contextTokens.toLocaleString("en-US")} tokens leaves. ` +
    "Use less text, or pick a model with a larger window in Settings.";
}

/** Fits one call to a local model whose window is known: the reply's
 *  max_tokens, or why the call cannot run and the HTTP status to answer with. */
export function fitWindow(opts: {
  model: string;
  contextTokens: number;
  messages: LLMMessage[];
  budget: number;
  minReply: number;
}): { maxTokens: number } | { error: string; status: number } {
  const maxTokens = fitReply(opts.contextTokens, estimatePromptTokens(opts.messages), opts.budget, opts.minReply);
  return maxTokens === null ? { error: tooLongError(opts.model, opts.contextTokens), status: 400 } : { maxTokens };
}

/**
 * Fits one call to a local model: reads the model's window from its server
 * (`lookup`), then sizes the reply beside the prompt. Returns the reply's
 * max_tokens, or why the call cannot run and the HTTP status to answer with.
 */
export async function fitLocalCall(opts: {
  model: string;
  messages: LLMMessage[];
  budget: number;
  minReply: number;
  env: Pick<Deno.Env, "get">;
  lookup: typeof fetchLocalModelInfo;
}): Promise<{ maxTokens: number } | { error: string; status: number }> {
  const info = await opts.lookup(opts.model, opts.env);
  if ("error" in info) return { error: info.error, status: 503 };
  return fitWindow({ ...opts, contextTokens: info.contextTokens });
}
