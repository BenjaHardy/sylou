// ============================================================
// Per-function × per-model temperature tables — INLINED into
// each edge function folder. Source of truth: this file.
// Keep copies byte-identical across:
//   supabase/functions/chat/_temperatures.ts
//   supabase/functions/analysis/_temperatures.ts
//   supabase/functions/editor-action/_temperatures.ts
//   supabase/functions/context-prompt/_temperatures.ts
//
// Rationale:
//   - Supabase edge functions are isolated Deno modules; cross-folder
//     imports under _shared/ have historically been unreliable in this
//     project. A side investigation may consolidate _llm.ts, _repair.ts,
//     and _temperatures.ts into a single canonical _shared/ copy each
//     in a follow-up PR. Until then: copy-per-folder.
//   - Anthropic API hard-caps temperature at 1.0; resolveTemperature()
//     defensively clamps Claude models to [0, 1] as a second safety net
//     on top of the per-provider clamp inside _llm.ts.
//   - Unknown model IDs intentionally return `undefined` so callLLM
//     omits the temperature field entirely and the provider default
//     applies. Safer than guessing when a new model lands before this
//     table is updated.
//
// Per-function intent:
//   CHAT_TEMPERATURE    — conversational, preserve provider defaults.
//   EDITOR_TEMPERATURE  — inline editor actions, preserve defaults.
//   CONTEXT_TEMPERATURE — pre-analysis web-search summarization,
//                         preserve defaults.
//   FLOW_TEMPERATURE    — FLOW analysis, fully deterministic (0.0)
//                         to maximize schema compliance and reduce
//                         repair/retry rates.
// ============================================================

export type TemperatureTable = Record<string, number>;

export const CHAT_TEMPERATURE: TemperatureTable = {
  "mistral-large-latest": 0.7,
  "claude-sonnet-4-6":    1.0,
  "claude-opus-4-8":      1.0,
  "deepseek-chat":        1.0,
};

export const EDITOR_TEMPERATURE: TemperatureTable = {
  "mistral-large-latest": 0.7,
  "claude-sonnet-4-6":    1.0,
  "claude-opus-4-8":      1.0,
  "deepseek-chat":        1.0,
};

export const CONTEXT_TEMPERATURE: TemperatureTable = {
  "mistral-large-latest": 0.7,
  "claude-sonnet-4-6":    1.0,
  "claude-opus-4-8":      1.0,
  "deepseek-chat":        1.0,
};

export const FLOW_TEMPERATURE: TemperatureTable = {
  "mistral-large-latest": 0.0,
  "claude-sonnet-4-6":    0.0,
  "claude-opus-4-8":      0.0,
  "deepseek-chat":        0.0,
};

export function resolveTemperature(
  table: TemperatureTable,
  modelId: string,
): number | undefined {
  const raw = table[modelId];
  if (raw === undefined) return undefined;
  const ceiling = modelId.startsWith("claude-") ? 1.0 : Number.POSITIVE_INFINITY;
  return Math.min(ceiling, Math.max(0.0, raw));
}
