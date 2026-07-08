import { getModel } from "@/lib/models";

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

/** Context-window fallback when a model id isn't in the registry (e.g. a
 *  stale legacy preference) — deliberately conservative so an unknown
 *  model warns early, never late. */
const DEFAULT_CONTEXT_LIMIT = 200_000;

export type TokenStatus = "ok" | "near" | "over";

export interface TokenEstimation {
  estimatedTokens: number;
  contextLimit: number;
  ratio: number;
  status: TokenStatus;
}

/**
 * Classify token usage against the model's context limit, sourced from the
 * src/lib/models.ts registry (the single source of truth for limits).
 * "ok"   → ratio < 0.80 (safe, proceed automatically)
 * "near" → 0.80 ≤ ratio < 1.0 (warn, user can confirm)
 * "over" → ratio ≥ 1.0 (strong warning about truncation)
 */
export function classifyTokenUsage(
  estimatedTokens: number,
  model: string
): TokenEstimation {
  const contextLimit = getModel(model)?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
  const ratio = estimatedTokens / contextLimit;
  const status: TokenStatus =
    ratio >= 1.0 ? "over" : ratio >= 0.8 ? "near" : "ok";

  return { estimatedTokens, contextLimit, ratio, status };
}
