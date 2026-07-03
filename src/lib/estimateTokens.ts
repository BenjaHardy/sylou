/**
 * Estimate the number of tokens for a given text using two methods,
 * returning the maximum for safety.
 *
 * Method 1: character-based  → Math.ceil(text.length / 4) * 1.1
 * Method 2: word-based       → wordCount * 1.3
 */
export function estimateTokens(text: string): number {
  const charEst = Math.ceil(text.length / 4) * 1.1;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const wordEst = wordCount * 1.3;
  return Math.ceil(Math.max(charEst, wordEst));
}

/** Context window sizes for supported models */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  "claude-sonnet-4-6": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-opus": 200_000,
  "mistral-large-latest": 256_000,
  "mistral-large-2512":   256_000,
  "mistral-medium-3-5":   256_000,
  "mistral-small-2603":   256_000,
  "mistral-large-3": 256_000,
  "deepseek-v4-flash": 1_000_000,
  "deepseek-chat": 1_000_000, // legacy rolling alias (upstream-discontinued 2026-07-24)
  default: 200_000,
};

export type TokenStatus = "ok" | "near" | "over";

export interface TokenEstimation {
  estimatedTokens: number;
  contextLimit: number;
  ratio: number;
  status: TokenStatus;
}

/**
 * Classify token usage against context limit.
 * "ok"   → ratio < 0.80 (safe, proceed automatically)
 * "near" → 0.80 ≤ ratio < 1.0 (warn, user can confirm)
 * "over" → ratio ≥ 1.0 (strong warning about truncation)
 */
export function classifyTokenUsage(
  estimatedTokens: number,
  model: string = "claude-sonnet-4-6"
): TokenEstimation {
  const contextLimit = MODEL_CONTEXT_LIMITS[model] ?? MODEL_CONTEXT_LIMITS.default;
  const ratio = estimatedTokens / contextLimit;
  const status: TokenStatus =
    ratio >= 1.0 ? "over" : ratio >= 0.8 ? "near" : "ok";

  return { estimatedTokens, contextLimit, ratio, status };
}
