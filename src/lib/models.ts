/**
 * Central registry of LLMs available to the user for chat & FLOW analysis.
 * Keep this in sync with the edge functions' copy in
 * supabase/functions/_shared/_models.ts (ALLOWED_MODELS, CONTEXT_LIMIT_TOKENS);
 * models.test.ts fails when the model lists differ.
 */

export type ModelProvider = "mistral" | "anthropic" | "deepseek";

/** Where the maintainer's field tests place a model for FLOW analysis:
 *  "recommended" = the defaults (reliability, speed and cost), "alternative"
 *  = good FLOW results without that mix. Models with no tier are not
 *  recommended. */
export type FlowTier = "recommended" | "alternative";

export interface ModelInfo {
  id: string;
  label: string;
  provider: ModelProvider;
  /** Indicative provider price per 1M tokens, USD. October 2026. */
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
  /** The model's FLOW tier (see FlowTier). Drives the grouping of the FLOW
   *  picker in Settings (see groupModelsForFlow); docs/model-configuration.md
   *  holds the rationale per model. Until 2026-09 this lived only in the
   *  wording of `note`. */
  flowTier?: FlowTier;
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
    // Third-party open model (Z.ai) hosted unmodified on the Mistral API
    // (EU); routed through the Mistral path (id has no claude-/deepseek-
    // prefix). The default chat and FLOW model. Recommended for FLOW again
    // since FLOW prompt v1.5 (2026-10-06) removed the user-leaning scores
    // the 2026-10-02 field test had found at every reasoning level.
    note: "Third-party model hosted on the Mistral API",
    flowTier: "recommended",
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    provider: "anthropic",
    pricing: { input: 3.0, output: 15.0 },
    contextLimit: 1_000_000,
    flowTier: "alternative",
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    provider: "anthropic",
    pricing: { input: 2.0, output: 10.0 },
    contextLimit: 1_000_000,
    flowTier: "recommended",
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    pricing: { input: 5.0, output: 25.0 },
    contextLimit: 1_000_000,
  },
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    provider: "anthropic",
    pricing: { input: 4.0, output: 20.0 },
    contextLimit: 1_000_000,
    flowTier: "alternative",
  },
  {
    id: "claude-fable-5-1",
    label: "Claude Fable 5.1",
    provider: "anthropic",
    pricing: { input: 10.0, output: 50.0 },
    contextLimit: 1_000_000,
    // Not recommended for FLOW (2026-10 field test): no gain over Opus 5.5
    // at 2.5x the price.
    note: "Anthropic's most capable model. Slower, and needs an Anthropic account with 30-day data retention.",
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "deepseek",
    // Legacy id: DeepSeek retired V4 Flash and serves this id with
    // DeepSeek-V4.1-Flash at the Flash price (peak rate; half off-peak).
    pricing: { input: 0.30, output: 1.20 },
    contextLimit: 1_000_000,
    isExperimental: true,
    note: "Served by DeepSeek V4.1 Flash since DeepSeek retired V4 Flash",
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
export const FLOW_ALTERNATIVE_GROUP_ID = "flow-alternative";
export const FLOW_OTHER_GROUP_ID = "flow-not-recommended";

/** Inside each FLOW group: Anthropic first, then the Mistral API, then any
 *  other provider — the chat picker's group order. Registry order is kept
 *  within a provider (Array.prototype.sort is stable). */
const FLOW_PROVIDER_ORDER: ModelProvider[] = ["anthropic", "mistral"];
function flowProviderRank(m: ModelInfo): number {
  const i = FLOW_PROVIDER_ORDER.indexOf(m.provider);
  return i === -1 ? FLOW_PROVIDER_ORDER.length : i;
}

/** FLOW picker: the recommended models first, the alternatives behind a
 *  second group, every other model behind a third (the UI tops the last two
 *  with a notice each). Empty groups are omitted. */
export function groupModelsForFlow(models: ModelInfo[] = MODELS): ModelGroup[] {
  const tier = (t: FlowTier | undefined): ModelInfo[] =>
    models.filter((m) => m.flowTier === t).sort((a, b) => flowProviderRank(a) - flowProviderRank(b));
  const groups: ModelGroup[] = [
    { id: FLOW_RECOMMENDED_GROUP_ID, label: "Recommended for FLOW", models: tier("recommended") },
    { id: FLOW_ALTERNATIVE_GROUP_ID, label: "Alternatives for FLOW", models: tier("alternative") },
    { id: FLOW_OTHER_GROUP_ID, label: "Not currently recommended", models: tier(undefined) },
  ];
  return groups.filter((g) => g.models.length > 0);
}

// Defaults for new profiles, mirrored by the profiles column defaults
// (migrations 20261001120000 / 20261011120000) and by the edge functions'
// fallback (DEFAULT_CHAT_MODEL / DEFAULT_FLOW_MODEL in
// supabase/functions/_shared/_models.ts). models.test.ts pins that the FLOW
// default is a recommended model and that the functions' copy matches.
export const DEFAULT_CHAT_MODEL = "zai-glm-5-3";
export const DEFAULT_FLOW_MODEL = "zai-glm-5-3";

/** A reasoning level a user can pick for a chat model. */
export interface ReasoningChoice {
  id: string;
  label: string;
}

const OFF: ReasoningChoice = { id: "off", label: "Off" };
const LOW: ReasoningChoice = { id: "low", label: "Low" };
const MEDIUM: ReasoningChoice = { id: "medium", label: "Medium" };
const HIGH: ReasoningChoice = { id: "high", label: "High" };
/** Claude's xhigh. */
const EXTRA: ReasoningChoice = { id: "xhigh", label: "Extra" };
// The deepest level (GLM 5.3's max, Claude's uncapped max) thinks for a
// minute or more before the first answer token: say so where it is chosen.
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
  "claude-sonnet-5-5": { options: [OFF, LOW, MEDIUM, HIGH, EXTRA, MAX_SLOW], defaultId: "medium" },
  "claude-opus-4-8": { options: [OFF, LOW, MEDIUM, HIGH, EXTRA, MAX_SLOW], defaultId: "high" },
  "claude-opus-5-5": { options: [LOW, MEDIUM, HIGH, EXTRA, MAX_SLOW], defaultId: "medium" },
  "claude-fable-5-1": { options: [LOW, MEDIUM, HIGH, EXTRA, MAX_SLOW], defaultId: "medium" },
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
 *  reasoning control. (The server-side twin is resolveReasoning in
 *  _shared/_thinking.ts.) */
export function resolveReasoningId(
  modelId: string,
  choices: Record<string, string> | undefined,
  table: ReasoningOptionsByModel = CHAT_REASONING_OPTIONS,
): string | null {
  const entry = table[modelId];
  if (!entry) return null;
  const stored = choices?.[modelId];
  return entry.options.some((o) => o.id === stored) ? (stored as string) : entry.defaultId;
}

/** The label of the level in force (see resolveReasoningId), or null. */
export function resolveReasoningLabel(
  modelId: string,
  choices: Record<string, string> | undefined,
): string | null {
  const id = resolveReasoningId(modelId, choices);
  if (id === null) return null;
  return CHAT_REASONING_OPTIONS[modelId].options.find((o) => o.id === id)?.label ?? null;
}
