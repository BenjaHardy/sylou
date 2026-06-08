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
  /** True when the model ID is a rolling alias that always resolves to the
   *  provider's current latest version (e.g. `mistral-large-latest`,
   *  `deepseek-chat`). Pinned version IDs leave this undefined. */
  isRollingLatest?: boolean;
  /** Optional one-line note shown beneath the row. */
  note?: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: "mistral-large-latest",
    label: "Mistral Large",
    provider: "mistral",
    pricing: { input: 2.0, output: 6.0 },
    contextLimit: 256_000,
    isRollingLatest: true,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    pricing: { input: 3.0, output: 15.0 },
    contextLimit: 1_000_000,
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    pricing: { input: 5.0, output: 25.0 },
    contextLimit: 1_000_000,
    note: "Recommended for FLOW analysis",
  },
  {
    id: "deepseek-chat",
    label: "DeepSeek Chat",
    provider: "deepseek",
    pricing: { input: 0.14, output: 0.28 },
    contextLimit: 1_000_000,
    isExperimental: true,
    isRollingLatest: true,
  },
];

export const MODEL_LABELS: Record<string, string> = MODELS.reduce(
  (acc, m) => {
    acc[m.id] = m.label;
    return acc;
  },
  {
    // Legacy IDs — kept so historical chat_messages.model_used /
    // flow_reports.model_used rows still render a friendly label.
    "mistral-large-3": "Mistral Large",
    "deepseek-v4-flash": "DeepSeek Chat",
    "claude-opus-4-7": "Claude Opus 4.7",
  } as Record<string, string>,
);

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export const DEFAULT_CHAT_MODEL = "mistral-large-latest";
export const DEFAULT_FLOW_MODEL = "claude-sonnet-4-6";
