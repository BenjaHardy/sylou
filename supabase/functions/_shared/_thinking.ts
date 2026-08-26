// ============================================================
// Canonical per-function × per-model adaptive-thinking + effort tables.
//
// Single source of truth, imported via `../_shared/_thinking.ts` by:
//   supabase/functions/analysis/index.ts      (FLOW_THINKING / FLOW_EFFORT / FLOW_MISTRAL_EFFORT)
//   supabase/functions/chat/index.ts          (CHAT_THINKING / CHAT_EFFORT / CHAT_MISTRAL_EFFORT)
//   supabase/functions/editor-action/index.ts (EDITOR_THINKING / EDITOR_EFFORT / EDITOR_MISTRAL_EFFORT)
//   supabase/functions/context-prompt/index.ts (CONTEXT_THINKING / CONTEXT_EFFORT / CONTEXT_MISTRAL_EFFORT)
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
//   `zai-glm-5-2` (third-party, GLM-native thinking) has TWO levels,
//   "high" | "max" — "max" is GLM-only; Mistral's own models top out at
//   "high" and must never be configured with "max".
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
//             Mistral Medium 3.5 + Small at "high" — determinism matters.
//   CHAT    — Opus thinking + "high" Claude effort. Mistral Medium 3.5
//             at "high" (worth the latency); Small at "none" (chat speed).
//   EDITOR  — inline rewrites; Claude as above; Mistral reasoning OFF.
//   CONTEXT — pre-analysis summarization; Claude as above; Mistral Medium
//             3.5 at "high", Small at "none".
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
//   * Average FLOW elapsed > 100s on GLM 5.2 at "max" across ≥5 runs
//       → drop FLOW_MISTRAL_EFFORT["zai-glm-5-2"] to "high"; any single
//         run past the 145s in-contract timeout → "high" immediately,
//         then "none" if it persists.
// ============================================================

export type ClaudeEffort  = "low" | "medium" | "high" | "xhigh";
export type MistralEffort = "high" | "max" | "none";

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
  "zai-glm-5-2",
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
// Small at "none" for latency.
export const FLOW_MISTRAL_EFFORT:    MistralEffortTable = { "mistral-medium-3-5": "none", "mistral-small-2603": "high", "zai-glm-5-2": "max" };
export const CHAT_MISTRAL_EFFORT:    MistralEffortTable = { "mistral-medium-3-5": "high", "mistral-small-2603": "none", "zai-glm-5-2": "max" };
export const EDITOR_MISTRAL_EFFORT:  MistralEffortTable = { "mistral-medium-3-5": "none", "mistral-small-2603": "none", "zai-glm-5-2": "none" };
export const CONTEXT_MISTRAL_EFFORT: MistralEffortTable = { "mistral-medium-3-5": "high", "mistral-small-2603": "none", "zai-glm-5-2": "max" };

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
// Mistral reasoning models (Medium 3.5, Small, GLM 5.2) at "high"/"max"
// effort emit reasoning tokens into the same budget and need the same
// headroom.
// Non-reasoning callers keep their base.
export function resolveMaxTokens(
  base: number,
  modelId: string,
  thinkingOn: boolean,
  mistralEffortOn = false,
): number {
  const reasoningOn = thinkingOn || mistralEffortOn;
  if (!reasoningOn) return base;
  if (!modelId.startsWith("claude-") && !MISTRAL_REASONING_MODELS.has(modelId)) return base;
  if (base <= 1000) return 2500;   // editor-action
  if (base <= 2000) return 4000;   // chat, context-prompt
  return Math.max(base, 16000);    // analysis (FLOW)
}
