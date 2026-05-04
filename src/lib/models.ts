/**
 * Central registry of LLMs available to the user for chat & FLOW analysis.
 * Keep this in sync with the inline `callLLM` helper in each Supabase edge
 * function (chat/, analysis/, editor-action/, context-prompt/).
 */

export type ModelProvider = "mistral" | "anthropic" | "deepseek";

export interface ModelInfo {
  id: string;
  label: string;
  provider: ModelProvider;
  /** Indicative provider price per 1M tokens, USD. April 2026. */
  pricing: { input: number; output: number };
  /** Maximum context window in tokens. */
  contextLimit: number;
  /** Marked for the UI to flag less-mature models. */
  isExperimental?: boolean;
  /** Optional one-line note shown beneath the row. */
  note?: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: "mistral-large-3",
    label: "Mistral Large 3",
    provider: "mistral",
    pricing: { input: 2.0, output: 6.0 },
    contextLimit: 256_000,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    pricing: { input: 3.0, output: 15.0 },
    contextLimit: 1_000_000,
    note: "Recommended for FLOW analysis",
  },
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    provider: "anthropic",
    pricing: { input: 5.0, output: 25.0 },
    contextLimit: 1_000_000,
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    pricing: { input: 0.14, output: 0.28 },
    contextLimit: 1_000_000,
    isExperimental: true,
  },
];

export const MODEL_LABELS: Record<string, string> = MODELS.reduce(
  (acc, m) => {
    acc[m.id] = m.label;
    return acc;
  },
  {
    // Legacy slug fallback (data may have been backfilled but tolerate stragglers)
    "mistral-large-latest": "Mistral Large 3",
  } as Record<string, string>,
);

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export const DEFAULT_CHAT_MODEL = "mistral-large-3";
export const DEFAULT_FLOW_MODEL = "claude-sonnet-4-6";
