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
  /** True when the maintainer's field tests recommend the model for FLOW
   *  analysis. Drives the grouping of the FLOW picker in Settings (see
   *  groupModelsForFlow); docs/model-configuration.md holds the rationale
   *  per model. Until 2026-09 this lived only in the wording of `note`. */
  flowRecommended?: boolean;
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
    id: "zai-glm-5-3",
    label: "Z.ai GLM 5.3 (via Mistral)",
    provider: "mistral",
    pricing: { input: 1.40, output: 4.40 },
    contextLimit: 1_000_000,
    // Third-party open model (Z.ai) hosted unmodified on the Mistral API —
    // EU infrastructure. Routed through the Mistral path (id has no
    // claude-/deepseek- prefix). Replaced GLM 5.2 in 2026-10 (Mistral
    // retires zai-glm-5-2 on 2026-10-31) at the same price and context
    // window; the per-function reasoning levels live in
    // _shared/_thinking.ts (see docs/model-configuration.md). The default
    // chat model. NOT recommended for FLOW (field test 2026-10-02): at
    // every reasoning level its scores lean towards the user, unlike GLM
    // 5.2 at "max", which was recommended.
    note: "Third-party model hosted on the Mistral API",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    pricing: { input: 3.0, output: 15.0 },
    contextLimit: 1_000_000,
    flowRecommended: true,
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
    "zai-glm-5-2":           "Z.ai GLM 5.2 (via Mistral)",
  } as Record<string, string>,
);

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

/** The reference the Settings pickers link to for per-model rationale. */
export const MODEL_CONFIG_DOC_URL =
  "https://github.com/BenjaHardy/sylou/blob/main/docs/model-configuration.md";

/** Short names of the API that serves a model, for the muted tag on the
 *  FLOW picker's cards. GLM is a third-party model served by the Mistral
 *  API, hence "Mistral API" rather than "Mistral". */
export const PROVIDER_LABELS: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  mistral: "Mistral API",
  deepseek: "DeepSeek",
};

/** A titled slice of the registry, as rendered by the Settings pickers. */
export interface ModelGroup {
  id: string;
  label: string;
  models: ModelInfo[];
}

/** Chat picker: models grouped by the API that serves them. A provider
 *  without a dedicated group lands in "Other providers", so adding one to
 *  the registry needs no change here. Empty groups are omitted; registry
 *  order is kept inside each group. */
export function groupModelsByProvider(models: ModelInfo[] = MODELS): ModelGroup[] {
  const groups: ModelGroup[] = [
    { id: "anthropic", label: "Anthropic (Claude)", models: models.filter((m) => m.provider === "anthropic") },
    { id: "mistral", label: "Mistral API", models: models.filter((m) => m.provider === "mistral") },
    {
      id: "other",
      label: "Other providers",
      models: models.filter((m) => m.provider !== "anthropic" && m.provider !== "mistral"),
    },
  ];
  return groups.filter((g) => g.models.length > 0);
}

export const FLOW_RECOMMENDED_GROUP_ID = "flow-recommended";
export const FLOW_OTHER_GROUP_ID = "flow-not-recommended";

/** FLOW picker: the recommended models first, every other model behind a
 *  second group (the UI tops it with a "not currently recommended" notice).
 *  Empty groups are omitted. */
export function groupModelsForFlow(models: ModelInfo[] = MODELS): ModelGroup[] {
  const groups: ModelGroup[] = [
    { id: FLOW_RECOMMENDED_GROUP_ID, label: "Recommended for FLOW", models: models.filter((m) => m.flowRecommended) },
    { id: FLOW_OTHER_GROUP_ID, label: "Not currently recommended", models: models.filter((m) => !m.flowRecommended) },
  ];
  return groups.filter((g) => g.models.length > 0);
}

// Defaults for new profiles (mirrored by the profiles column defaults in
// migrations 20261001120000 / 20261002120000 and by the edge functions'
// NULL-preference fallback). Chat: GLM 5.3 since 2026-10 (GLM 5.2 from
// 2026-09-25, Mistral Medium 3.5 before). FLOW: Claude Sonnet 4.6 since
// 2026-10-02 — the one model still recommended for FLOW once GLM 5.3
// failed the field test (GLM 5.2 was the default from 2026-09-25).
export const DEFAULT_CHAT_MODEL = "zai-glm-5-3";
export const DEFAULT_FLOW_MODEL = "claude-sonnet-4-6";

/** A reasoning level a user can pick for a chat model. */
export interface ReasoningChoice {
  id: string;
  label: string;
}

const OFF: ReasoningChoice = { id: "off", label: "Off" };
const LOW: ReasoningChoice = { id: "low", label: "Low" };
const MEDIUM: ReasoningChoice = { id: "medium", label: "Medium" };
const HIGH: ReasoningChoice = { id: "high", label: "High" };
const MAX: ReasoningChoice = { id: "max", label: "Max" };
// GLM 5.3's deep-reasoning level thinks for a minute or more before the
// first answer token (2026-10 measurements): say so where it is chosen.
const MAX_SLOW: ReasoningChoice = { id: "max", label: "Max (slow)" };

/** Reasoning levels per chat model (Settings → Models, chat picker) and the
 *  level the code applies when nothing is chosen. Mirror of
 *  CHAT_REASONING_OPTIONS in supabase/functions/_shared/_thinking.ts — KEEP
 *  IN SYNC (the server validates the stored choice, so a drift here only
 *  mislabels the picker). Applies to chat and Ask/Propose; FLOW, editor
 *  actions and document summaries keep the settings fixed in code. Models
 *  absent here (Mistral Large 3, DeepSeek) have no reasoning control. */
export const CHAT_REASONING_OPTIONS: Readonly<
  Record<string, { options: ReasoningChoice[]; defaultId: string }>
> = {
  "claude-sonnet-4-6": { options: [OFF, LOW, MEDIUM, HIGH], defaultId: "off" },
  "claude-opus-4-8": { options: [OFF, LOW, MEDIUM, HIGH, MAX], defaultId: "high" },
  "mistral-medium-3-5": { options: [OFF, HIGH], defaultId: "high" },
  "mistral-small-2603": { options: [OFF, HIGH], defaultId: "off" },
  "zai-glm-5-3": { options: [LOW, HIGH, MAX_SLOW], defaultId: "high" },
};

/** Reasoning levels per model id and the one the code applies by default. */
export type ReasoningOptionsByModel = Readonly<
  Record<string, { options: ReasoningChoice[]; defaultId: string }>
>;

/** The option id in force for a chat model: the stored choice when it is
 *  one of the model's options, else the default; null when the model has no
 *  reasoning control. */
export function effectiveReasoningId(
  modelId: string,
  choices: Record<string, string> | undefined,
  table: ReasoningOptionsByModel = CHAT_REASONING_OPTIONS,
): string | null {
  const entry = table[modelId];
  if (!entry) return null;
  const stored = choices?.[modelId];
  return entry.options.some((o) => o.id === stored) ? (stored as string) : entry.defaultId;
}

/** The label of the level in force (see effectiveReasoningId), or null. */
export function reasoningLabelFor(
  modelId: string,
  choices: Record<string, string> | undefined,
): string | null {
  const id = effectiveReasoningId(modelId, choices);
  if (id === null) return null;
  return CHAT_REASONING_OPTIONS[modelId].options.find((o) => o.id === id)?.label ?? null;
}
