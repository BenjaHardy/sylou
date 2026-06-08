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
// Per-function intent:
//   CHAT_TEMPERATURE    — conversational, preserve provider defaults.
//   EDITOR_TEMPERATURE  — inline editor actions, preserve defaults.
//   CONTEXT_TEMPERATURE — pre-analysis web-search summarization,
//                         preserve defaults.
//   FLOW_TEMPERATURE    — FLOW analysis, fully deterministic (0.0)
//                         on every provider that accepts a value,
//                         to maximize schema compliance and reduce
//                         repair/retry rates.
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
  "mistral-large-latest": 0.7,
  "claude-sonnet-4-6":    1.0,
  "deepseek-chat":        1.0,
};

export const EDITOR_TEMPERATURE: TemperatureTable = {
  "mistral-large-latest": 0.7,
  "claude-sonnet-4-6":    1.0,
  "deepseek-chat":        1.0,
};

export const CONTEXT_TEMPERATURE: TemperatureTable = {
  "mistral-large-latest": 0.7,
  "claude-sonnet-4-6":    1.0,
  "deepseek-chat":        1.0,
};

export const FLOW_TEMPERATURE: TemperatureTable = {
  "mistral-large-latest": 0.0,
  "claude-sonnet-4-6":    0.0,
  "deepseek-chat":        0.0,
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
