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
  /** Indicative provider price per 1M tokens, USD. June 2026. */
  pricing: { input: number; output: number };
  /** Maximum context window in tokens. */
  contextLimit: number;
  /** Marked for the UI to flag less-mature models. */
  isExperimental?: boolean;
  /** True when the model ID is a rolling alias that always resolves to the
   *  provider's current latest version. Pinned version IDs leave this
   *  undefined — every registry model is pinned today (Mistral by dated
   *  alias, DeepSeek by family id since upstream discontinued the rolling
   *  `deepseek-chat` alias on 2026-07-24) so version bumps are deliberate
   *  (test → update → redeploy) rather than auto-applied. */
  isRollingLatest?: boolean;
  /** Optional one-line note shown beneath the row. */
  note?: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: "mistral-small-2603",
    label: "Mistral Small 4",
    provider: "mistral",
    pricing: { input: 0.15, output: 0.60 },
    contextLimit: 256_000,
  },
  {
    id: "mistral-medium-3-5",
    label: "Mistral Medium 3.5",
    provider: "mistral",
    pricing: { input: 1.50, output: 7.50 },
    contextLimit: 256_000,
    // FLOW recommendation removed 2026-07: field testing showed user-leaning
    // bias when the Write pillar is high, and weak pillar segregation (one
    // pillar colouring the others). See docs/model-configuration.md, "FLOW
    // (analysis)". Fine for chat.
  },
  {
    id: "mistral-large-2512",
    label: "Mistral Large 3",
    provider: "mistral",
    pricing: { input: 0.50, output: 1.50 },
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
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
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
    // Legacy IDs — kept so historical chat_messages.model_used /
    // flow_reports.model_used rows still render a friendly label.
    "mistral-large-3":       "Mistral Large",
    "mistral-large-latest":  "Mistral Large",
    "mistral-small-latest":  "Mistral Small",
    "deepseek-chat":         "DeepSeek Chat",
    "claude-opus-4-7":       "Claude Opus 4.7",
  } as Record<string, string>,
);

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export const DEFAULT_CHAT_MODEL = "mistral-medium-3-5";
export const DEFAULT_FLOW_MODEL = "mistral-medium-3-5";
