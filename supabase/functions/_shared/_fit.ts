// Sizing a call to a local model. Ollama drops what does not fit the
// model's context window without an error, so a call to a local model is
// measured first: the prompt's estimated tokens and room for the reply must
// fit the window, or the call does not run.

import type { LLMMessage } from "./_llm.ts";
import { type fetchLocalModelInfo, ollamaName } from "./_ollama.ts";

/** Tokens a chat template adds around each message (role markers, separators). */
const MESSAGE_OVERHEAD_TOKENS = 8;

/** A cautious token count: one token per 3 bytes of UTF-8. Prose in Latin
 *  scripts runs at about 4–5 characters a token; a CJK character takes 3
 *  bytes and about one token. */
export function estimateTokens(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 3);
}

/** The estimated tokens of a message list. */
export function estimatePromptTokens(messages: LLMMessage[]): number {
  return messages.reduce((sum, m) => {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
    return sum + MESSAGE_OVERHEAD_TOKENS + estimateTokens(text);
  }, 0);
}

/** Window kept free for text that tokenizes denser than the estimate. */
const WINDOW_MARGIN_TOKENS = 256;

/** max_tokens for a reply beside its prompt in a window: the budget, or the
 *  room the window leaves (less a margin) when that is smaller; null when
 *  less than `minReply` is left. */
export function fitReply(contextTokens: number, promptTokens: number, budget: number, minReply: number): number | null {
  const room = contextTokens - WINDOW_MARGIN_TOKENS - promptTokens;
  return room < minReply ? null : Math.min(budget, room);
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
  const maxTokens = fitReply(info.contextTokens, estimatePromptTokens(opts.messages), opts.budget, opts.minReply);
  if (maxTokens === null) {
    return {
      error: `Too long for ${ollamaName(opts.model)}: the text, favourite documents included, needs more room ` +
        `than its window of ${info.contextTokens.toLocaleString("en-US")} tokens leaves. ` +
        "Use less text, or pick a model with a larger window in Settings.",
      status: 400,
    };
  }
  return { maxTokens };
}
