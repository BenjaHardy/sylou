// ============================================================
// Canonical per-function × per-model adaptive-thinking + effort tables.
//
// Single source of truth, imported via `../_shared/_thinking.ts` by:
//   supabase/functions/analysis/index.ts      (FLOW_THINKING / FLOW_EFFORT / FLOW_MISTRAL_EFFORT)
//   supabase/functions/chat/index.ts          (CHAT_THINKING / CHAT_EFFORT / CHAT_MISTRAL_EFFORT)
//   supabase/functions/editor-action/index.ts (EDITOR_THINKING / EDITOR_EFFORT / EDITOR_MISTRAL_EFFORT)
//   supabase/functions/context-prompt/index.ts (CONTEXT_THINKING / CONTEXT_EFFORT / CONTEXT_MISTRAL_EFFORT)
//   supabase/functions/extract-text/index.ts  (SUMMARY_MISTRAL_EFFORT)
//   supabase/functions/_shared/_conversation_memory.ts (SUMMARY_MISTRAL_EFFORT)
//
// References:
//   - Adaptive thinking: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
//   - Effort parameter:  https://platform.claude.com/docs/en/build-with-claude/effort
//   - Migration guide:   https://platform.claude.com/docs/en/about-claude/models/migration-guide
//   - Mistral reasoning: https://docs.mistral.ai/capabilities/reasoning/
//
// Verified defaults at the Anthropic API (Dec 2025):
//   - Effort default on Opus 4.7/4.8 and Sonnet 4.6 is already `"high"`
//     (migration guide §"Start at `high` effort"). Sending `high`
//     explicitly is therefore a documentation-grade no-op against the
//     current provider default. We keep it set explicitly so a future
//     default shift doesn't silently regress us, and so per-function
//     overrides (e.g. dropping FLOW Opus to "medium") are a one-line
//     table edit rather than a code change.
//   - When no `thinking` field is sent, Opus 4.7/4.8 and Sonnet 4.6
//     run WITHOUT thinking. Adaptive thinking is opt-in on these
//     models (it is always-on on Fable 5 / Mythos 5, which we do not
//     yet use).
//
// Mistral reasoning:
//   `mistral-medium-3-5` and `mistral-small-2603` accept an OpenAI-shape
//   `reasoning_effort` field with values "high" | "none". `mistral-large-2512`
//   is NOT a reasoning model — the Mistral API rejects `reasoning_effort`
//   with HTTP 422 on non-reasoning models. MISTRAL_REASONING_MODELS is the
//   single allowlist: resolveMistralEffort returns undefined for any model
//   not in this set, and the OpenAI-body builder only emits the field when
//   the value is defined and non-"none".
//   `zai-glm-5-3` (third-party, GLM-native thinking) is a reasoning-only
//   model: it accepts "low" | "high" | "max", defaults to "max" when the
//   field is omitted, and cannot run without thinking — so it is never
//   configured "none"; "low" is its lightest level. "low" and "max" are
//   GLM-only: Mistral's own models accept "high" | "none" and must never
//   be configured with either.
//
// DeepSeek:
//   `deepseek-v4-flash` (non-thinking mode) has no thinking toggle.
//   DeepSeek's reasoning lives in v4-flash's separate thinking mode
//   (exposed as `deepseek-reasoner` until that legacy id's 2026-07-24
//   discontinuation), which we do not currently route to.
//   resolveThinking / resolveEffort / resolveMistralEffort all return
//   falsy for DeepSeek so the request body is untouched.
//
// Per-function intent:
//   FLOW    — schema-bound analysis. Thinking ON for Opus only (Sonnet
//             is at 100% Structured Outputs success without it; don't
//             risk regressing what's working). Effort "high" both Claudes.
//             Mistral Small at "high", Medium 3.5 at "none", GLM 5.3 at "high".
//   CHAT    — Opus thinking + "high" Claude effort. Mistral Medium 3.5
//             at "high" (worth the latency); Small at "none" (chat speed);
//             GLM 5.3 at "high" — its "max" is the deep-reasoning level
//             and spent whole chat budgets thinking (2026-10).
//   EDITOR  — inline rewrites; Claude as above; Mistral reasoning OFF
//             (GLM 5.3 at "low": it cannot switch reasoning off).
//   CONTEXT — pre-analysis summarization; Claude as above; Mistral Medium
//             3.5 at "high", Small at "none", GLM 5.3 at "high".
//   SUMMARY — document-import and conversation-memory summaries
//             (extract-text, _conversation_memory.ts); Mistral reasoning
//             OFF, GLM 5.3 at "low".
//
// Regression guardrails (operate against baseline elapsed times
// captured immediately after deploy — see plan):
//   * Average FLOW elapsed > 120s on Opus across ≥5 runs
//       → change FLOW_EFFORT["claude-opus-4-8"] to "medium".
//   * Any single FLOW analysis > 150s wall-clock
//       → roll back this change.
//   * First-attempt Structured Outputs success rate < 90% on Claude
//       → investigate (likely raise the base max_tokens before
//         reducing effort).
//   * Average FLOW elapsed > 100s on Mistral Medium 3.5 across ≥5 runs
//       → flip FLOW_MISTRAL_EFFORT["mistral-medium-3-5"] to "none".
//   * GLM 5.3 is NOT recommended for FLOW (field test 2026-10-02): at
//     "low", "high" and "max" alike its scores lean towards the user,
//     unlike GLM 5.2 at "max". Left at "high" for anyone who selects it
//     anyway — fast, and the FLOW reasoning ceiling never binds there
//     ("max" needed the whole ceiling for its think and still failed the
//     test).
// ============================================================

import type { OutputBudget } from "./_models.ts";

export type ClaudeEffort  = "low" | "medium" | "high" | "xhigh";
export type MistralEffort = "low" | "high" | "max" | "none";

export type ThinkingTable       = Record<string, boolean>;
export type EffortTable         = Record<string, ClaudeEffort>;
export type MistralEffortTable  = Record<string, MistralEffort>;

// Legacy alias — kept exported so older imports don't break during the
// rename rollout. New code should use ClaudeEffort directly.
export type EffortLevel = ClaudeEffort;

// Allowlist of Mistral models that accept `reasoning_effort`. The
// Mistral API returns HTTP 422 if the field is sent to any other
// model (e.g. mistral-large-2512). Add new reasoning models here.
export const MISTRAL_REASONING_MODELS = new Set<string>([
  "mistral-medium-3-5",
  "mistral-small-2603",
  "zai-glm-5-3",
]);

// Defaults: adaptive thinking ON for Opus only. Sonnet stays OFF
// (currently 100% Structured Outputs success — don't risk it).
export const FLOW_THINKING:    ThinkingTable = { "claude-sonnet-4-6": false, "claude-opus-4-8": true };
export const CHAT_THINKING:    ThinkingTable = { "claude-sonnet-4-6": false, "claude-opus-4-8": true };
export const EDITOR_THINKING:  ThinkingTable = { "claude-sonnet-4-6": false, "claude-opus-4-8": true };
export const CONTEXT_THINKING: ThinkingTable = { "claude-sonnet-4-6": false, "claude-opus-4-8": true };

export const FLOW_EFFORT:    EffortTable = { "claude-sonnet-4-6": "high", "claude-opus-4-8": "high" };
export const CHAT_EFFORT:    EffortTable = { "claude-sonnet-4-6": "high", "claude-opus-4-8": "high" };
export const EDITOR_EFFORT:  EffortTable = { "claude-sonnet-4-6": "high", "claude-opus-4-8": "high" };
export const CONTEXT_EFFORT: EffortTable = { "claude-sonnet-4-6": "high", "claude-opus-4-8": "high" };

// Mistral reasoning effort — only models in MISTRAL_REASONING_MODELS
// are eligible. Determinism wins for FLOW; chat-style functions prefer
// Small at "none" for latency. GLM 5.3 is reasoning-only, so "low" is
// its "off" (see the Mistral reasoning note above).
export const FLOW_MISTRAL_EFFORT:    MistralEffortTable = { "mistral-medium-3-5": "none", "mistral-small-2603": "high", "zai-glm-5-3": "high" };
export const CHAT_MISTRAL_EFFORT:    MistralEffortTable = { "mistral-medium-3-5": "high", "mistral-small-2603": "none", "zai-glm-5-3": "high" };
export const EDITOR_MISTRAL_EFFORT:  MistralEffortTable = { "mistral-medium-3-5": "none", "mistral-small-2603": "none", "zai-glm-5-3": "low" };
export const CONTEXT_MISTRAL_EFFORT: MistralEffortTable = { "mistral-medium-3-5": "high", "mistral-small-2603": "none", "zai-glm-5-3": "high" };
export const SUMMARY_MISTRAL_EFFORT: MistralEffortTable = { "mistral-medium-3-5": "none", "mistral-small-2603": "none", "zai-glm-5-3": "low" };

export function resolveThinking(table: ThinkingTable, modelId: string): boolean {
  if (!modelId.startsWith("claude-")) return false;
  return table[modelId] ?? false;
}

export function resolveEffort(table: EffortTable, modelId: string): ClaudeEffort | undefined {
  if (!modelId.startsWith("claude-")) return undefined;
  const raw = table[modelId];
  if (!raw) return undefined;
  // Sonnet 4.6 does not accept "xhigh" effort. Clamp LOUDLY so
  // misconfiguration surfaces in logs instead of being silently
  // corrected — especially important if user-selectable overrides
  // are added later (a user setting xhigh would otherwise never
  // know it was silently downgraded).
  if (modelId === "claude-sonnet-4-6" && raw === "xhigh") {
    console.warn(
      `[effort] Sonnet does not support xhigh effort; clamped to high ` +
      `(model=${modelId}). Update the per-function effort table to ` +
      `silence this warning.`,
    );
    return "high";
  }
  return raw;
}

/**
 * Resolve the Mistral `reasoning_effort` value for a given model.
 *
 * Returns undefined unless the model is in MISTRAL_REASONING_MODELS AND
 * the table maps it to a non-"none" level. When it returns undefined, callers must
 * NOT include `reasoning_effort` in the outbound body — sending it to a
 * non-reasoning Mistral model is a hard 422 from the API. Returning
 * "none" is also handled as undefined here so the field is simply
 * omitted (Mistral treats omission as no reasoning, identical to "none"
 * but cheaper to keep out of the wire).
 */
export function resolveMistralEffort(
  table: MistralEffortTable,
  modelId: string,
): MistralEffort | undefined {
  if (!MISTRAL_REASONING_MODELS.has(modelId)) return undefined;
  const raw = table[modelId];
  if (!raw || raw === "none") return undefined;
  return raw;
}

// Adaptive thinking consumes the SAME output budget as response text
// (max_tokens is a hard limit on total output). Claude+thinking paths
// therefore need more headroom than the bare prompt would suggest.
// Mistral reasoning models (Medium 3.5, Small, GLM 5.3) at any explicit
// effort level emit reasoning tokens into the same budget and need the
// same headroom. Each OUTPUT_BUDGETS entry (_models.ts) carries both ceilings
// explicitly: `plain` for a non-reasoning call, `reasoning` when thinking
// or reasoning_effort is on for an eligible model. (Until 2026-09 the
// reasoning ceiling was inferred from the size of the base value, which
// would have silently mis-tiered any base that moved.)
export function resolveMaxTokens(
  budget: OutputBudget,
  modelId: string,
  thinkingOn: boolean,
  mistralEffortOn = false,
): number {
  const reasoningOn = thinkingOn || mistralEffortOn;
  if (!reasoningOn) return budget.plain;
  if (!modelId.startsWith("claude-") && !MISTRAL_REASONING_MODELS.has(modelId)) return budget.plain;
  return budget.reasoning;
}

// ── User-selectable reasoning (Settings → Models, chat picker) ────────────
// Chat and context-prompt (Ask/Propose) let the user pick a reasoning level
// per chat model, stored as a per-model map in
// profiles.preferred_chat_reasoning (e.g. {"zai-glm-5-3": "max"}).
// CHAT_REASONING_OPTIONS lists what each model accepts; the UI mirror is
// CHAT_REASONING_OPTIONS in src/lib/models.ts (ids + default per model) —
// KEEP IN SYNC. The default stays whatever the per-function tables above
// say (resolveReasoning falls back to them for a missing or unknown
// choice), so the tables remain the single source of truth for defaults and
// the options only add alternatives. FLOW, editor actions and the summary
// calls never read the user's choice.

export interface ReasoningOption {
  /** Stored id; "off" means no thinking / no reasoning_effort. */
  id: string;
  /** Claude: adaptive thinking on or off. */
  thinking?: boolean;
  /** Claude effort level. */
  effort?: ClaudeEffort;
  /** Mistral / GLM reasoning_effort ("none" is omitted from the request). */
  mistral_effort?: MistralEffort;
}

export const CHAT_REASONING_OPTIONS: Readonly<Record<string, readonly ReasoningOption[]>> = {
  "claude-sonnet-4-6": [
    { id: "off",    thinking: false, effort: "high" },
    { id: "low",    thinking: true,  effort: "low" },
    { id: "medium", thinking: true,  effort: "medium" },
    { id: "high",   thinking: true,  effort: "high" },
  ],
  "claude-opus-4-8": [
    { id: "off",    thinking: false, effort: "high" },
    { id: "low",    thinking: true,  effort: "low" },
    { id: "medium", thinking: true,  effort: "medium" },
    { id: "high",   thinking: true,  effort: "high" },
    { id: "max",    thinking: true,  effort: "xhigh" },
  ],
  "mistral-medium-3-5": [
    { id: "off",  mistral_effort: "none" },
    { id: "high", mistral_effort: "high" },
  ],
  "mistral-small-2603": [
    { id: "off",  mistral_effort: "none" },
    { id: "high", mistral_effort: "high" },
  ],
  "zai-glm-5-3": [
    { id: "low",  mistral_effort: "low" },
    { id: "high", mistral_effort: "high" },
    { id: "max",  mistral_effort: "max" },
  ],
};

/** The per-function default tables a call resolves against. */
export interface ReasoningTables {
  thinking: ThinkingTable;
  effort: EffortTable;
  mistral: MistralEffortTable;
}

export interface ResolvedReasoning {
  thinking: boolean;
  effort: ClaudeEffort | undefined;
  mistralEffort: MistralEffort | undefined;
  /** The option in force: the user's valid choice, else the default option
   *  id when the model has options, else null (fixed settings only). */
  optionId: string | null;
  /** True when a stored user choice was applied. */
  userChosen: boolean;
}

function knobsOf(
  modelId: string,
  option: ReasoningOption,
): Pick<ResolvedReasoning, "thinking" | "effort" | "mistralEffort"> {
  if (modelId.startsWith("claude-")) {
    return { thinking: option.thinking ?? false, effort: option.effort, mistralEffort: undefined };
  }
  const level = option.mistral_effort;
  return {
    thinking: false,
    effort: undefined,
    mistralEffort: MISTRAL_REASONING_MODELS.has(modelId) && level && level !== "none" ? level : undefined,
  };
}

function defaultsOf(modelId: string, tables: ReasoningTables) {
  return {
    thinking: resolveThinking(tables.thinking, modelId),
    effort: resolveEffort(tables.effort, modelId),
    mistralEffort: resolveMistralEffort(tables.mistral, modelId),
  };
}

/** The option id the tables amount to for a model (what the picker shows as
 *  the default), or null when the model has no options or the tables name a
 *  combination no option covers (a configuration drift — pinned by tests). */
export function defaultReasoningId(modelId: string, tables: ReasoningTables): string | null {
  const options = CHAT_REASONING_OPTIONS[modelId];
  if (!options) return null;
  const d = defaultsOf(modelId, tables);
  const match = options.find((o) => {
    const k = knobsOf(modelId, o);
    return k.thinking === d.thinking && k.effort === d.effort && k.mistralEffort === d.mistralEffort;
  });
  return match?.id ?? null;
}

/** Reasoning knobs for one call: the user's stored choice for this model
 *  when it is one of CHAT_REASONING_OPTIONS, else the per-function tables.
 *  `stored` is the raw profiles.preferred_chat_reasoning value (jsonb, so
 *  anything) and is trusted no further than "is it a known option id". */
export function resolveReasoning(modelId: string, stored: unknown, tables: ReasoningTables): ResolvedReasoning {
  const options = CHAT_REASONING_OPTIONS[modelId];
  const choice = stored && typeof stored === "object" && !Array.isArray(stored)
    ? (stored as Record<string, unknown>)[modelId]
    : undefined;
  const option = typeof choice === "string" ? options?.find((o) => o.id === choice) : undefined;
  if (option) {
    return { ...knobsOf(modelId, option), optionId: option.id, userChosen: true };
  }
  return { ...defaultsOf(modelId, tables), optionId: defaultReasoningId(modelId, tables), userChosen: false };
}
