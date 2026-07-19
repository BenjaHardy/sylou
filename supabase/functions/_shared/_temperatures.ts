// ============================================================
// Canonical per-function × per-model temperature tables.
//
// Single source of truth, imported via `../_shared/_temperatures.ts` by:
//   supabase/functions/analysis/index.ts      (FLOW_TEMPERATURE)
//   supabase/functions/chat/index.ts          (CHAT_TEMPERATURE)
//   supabase/functions/editor-action/index.ts (EDITOR_TEMPERATURE)
//   supabase/functions/context-prompt/index.ts (CONTEXT_TEMPERATURE)
//
// Anthropic temperature constraints (migration guide):
//   https://platform.claude.com/docs/en/about-claude/models/migration-guide
//
//   - Opus 4.7 and 4.8: the API returns a 400 error if `temperature`
//     is set to any non-default value. We MUST omit the field for
//     these models — see NO_TEMPERATURE_MODELS below.
//   - Sonnet 4.6: accepts `temperature` normally in [0, 1]. The
//     "non-default returns 400" rule applies to Opus 4.7+ ONLY, not
//     to Sonnet 4.6. Do not "consolidate" the safeguard to all
//     Claude models — that would silently strip a working knob for
//     Sonnet, where most FLOW runs happen and where 0.0 is exactly
//     the determinism we want.
//   - Mistral and DeepSeek: standard `[0, 2]`-ish range; we stay at
//     conservative provider defaults outside FLOW.
//
// Unknown model IDs intentionally return `undefined` so callLLM
// omits the temperature field entirely and the provider default
// applies. Safer than guessing when a new model lands before this
// table is updated.
//
// Every supported Mistral model is listed EXPLICITLY in every table —
// even when the value matches a value already used for another Mistral
// model. Rationale:
//   1. Consistency across Mistral models — no ambiguity about which
//      is on an explicit value vs the provider default.
//   2. Future tuning is a three-line edit, not "edit one + add two".
//   3. Same rationale as explicit Claude effort "high" defaults:
//      pinned behavior is robust to provider default drift.
//
// Per-function intent:
//   CHAT_TEMPERATURE    — conversational, provider-default-ish (0.7 / 1.0).
//   EDITOR_TEMPERATURE  — inline editor actions, same shape as CHAT.
//   CONTEXT_TEMPERATURE — pre-analysis web-search summarization,
//                         same shape as CHAT.
//   FLOW_TEMPERATURE    — FLOW analysis, fully deterministic (0.0)
//                         on every provider that accepts a value,
//                         to maximize schema compliance and reduce
//                         repair/retry rates.
//   SUMMARY_TEMPERATURE — conversation-memory consolidation
//                         (_conversation_memory.ts), low (0.3): faithful
//                         fact/decision carry-over matters more than prose
//                         variety, but not FLOW-style 0.0 — the summary
//                         still reads as prose.
// ============================================================

export type TemperatureTable = Record<string, number>;

// Models that REJECT any non-default temperature with HTTP 400.
// When a model is in this set, resolveTemperature() returns
// `undefined` regardless of what the table says, so callLLM omits
// the field entirely. As Anthropic ships new models, add them here
// only if they share this constraint — do NOT generalize to "all
// Claude models" (Sonnet 4.6 explicitly accepts temperature).
const NO_TEMPERATURE_MODELS = new Set<string>([
  "claude-opus-4-7",
  "claude-opus-4-8",
]);

export const CHAT_TEMPERATURE: TemperatureTable = {
  "mistral-large-2512":   0.7,
  "mistral-medium-3-5":   0.7,
  "mistral-small-2603":   0.7,
  "claude-sonnet-4-6":    1.0,
  "deepseek-v4-flash":    1.0,
};

export const EDITOR_TEMPERATURE: TemperatureTable = {
  "mistral-large-2512":   0.7,
  "mistral-medium-3-5":   0.7,
  "mistral-small-2603":   0.7,
  "claude-sonnet-4-6":    1.0,
  "deepseek-v4-flash":    1.0,
};

export const CONTEXT_TEMPERATURE: TemperatureTable = {
  "mistral-large-2512":   0.7,
  "mistral-medium-3-5":   0.7,
  "mistral-small-2603":   0.7,
  "claude-sonnet-4-6":    1.0,
  "deepseek-v4-flash":    1.0,
};

export const FLOW_TEMPERATURE: TemperatureTable = {
  "mistral-large-2512":   0.0,
  "mistral-medium-3-5":   0.0,
  "mistral-small-2603":   0.0,
  "claude-sonnet-4-6":    0.0,
  "deepseek-v4-flash":    0.0,
};

export const SUMMARY_TEMPERATURE: TemperatureTable = {
  "mistral-large-2512":   0.3,
  "mistral-medium-3-5":   0.3,
  "mistral-small-2603":   0.3,
  "claude-sonnet-4-6":    0.3,
  "deepseek-v4-flash":    0.3,
};

export function resolveTemperature(
  table: TemperatureTable,
  modelId: string,
): number | undefined {
  // Hard safeguard: never send temperature to models that 400 on it.
  if (NO_TEMPERATURE_MODELS.has(modelId)) return undefined;

  const raw = table[modelId];
  if (raw === undefined) return undefined;

  // Defensive clamp on Claude's documented [0, 1] range; other
  // providers accept wider ranges, so no upper bound for them.
  const ceiling = modelId.startsWith("claude-") ? 1.0 : Number.POSITIVE_INFINITY;
  return Math.min(ceiling, Math.max(0.0, raw));
}
