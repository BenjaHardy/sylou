// ============================================================
// Canonical per-function × per-model adaptive-thinking + effort tables.
//
// Single source of truth, imported via `../_shared/_thinking.ts` by:
//   supabase/functions/analysis/index.ts      (FLOW_THINKING / FLOW_EFFORT)
//   supabase/functions/chat/index.ts          (CHAT_THINKING / CHAT_EFFORT)
//   supabase/functions/editor-action/index.ts (EDITOR_THINKING / EDITOR_EFFORT)
//   supabase/functions/context-prompt/index.ts (CONTEXT_THINKING / CONTEXT_EFFORT)
//
// References:
//   - Adaptive thinking: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking
//   - Effort parameter:  https://platform.claude.com/docs/en/build-with-claude/effort
//   - Migration guide:   https://platform.claude.com/docs/en/about-claude/models/migration-guide
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
// Mistral / DeepSeek:
//   `mistral-large-latest` and `deepseek-chat` expose no thinking
//   toggle. DeepSeek's reasoning lives on the separate
//   `deepseek-reasoner` model, which we do not currently route to.
//   resolveThinking / resolveEffort return false / undefined for
//   non-Claude models so the request body is untouched.
//
// Per-function intent:
//   FLOW    — schema-bound analysis. Thinking ON for Opus only (Sonnet
//             is at 100% Structured Outputs success without it; don't
//             risk regressing what's working). Effort "high" both.
//   CHAT    — same shape (Opus-only thinking, "high" effort).
//   EDITOR  — inline rewrites; same shape.
//   CONTEXT — pre-analysis summarization; same shape.
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
// ============================================================

export type EffortLevel = "low" | "medium" | "high" | "xhigh";
export type ThinkingTable = Record<string, boolean>;
export type EffortTable   = Record<string, EffortLevel>;

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

export function resolveThinking(table: ThinkingTable, modelId: string): boolean {
  if (!modelId.startsWith("claude-")) return false;
  return table[modelId] ?? false;
}

export function resolveEffort(table: EffortTable, modelId: string): EffortLevel | undefined {
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

// Adaptive thinking consumes the SAME output budget as response text
// (max_tokens is a hard limit on total output). Claude+thinking paths
// therefore need more headroom than the bare prompt would suggest.
// Non-Claude callers and Claude-without-thinking keep their base.
export function resolveMaxTokens(base: number, modelId: string, thinkingOn: boolean): number {
  if (!modelId.startsWith("claude-") || !thinkingOn) return base;
  if (base <= 1000) return 2500;   // editor-action
  if (base <= 2000) return 4000;   // chat, context-prompt
  return Math.max(base, 16000);    // analysis (FLOW)
}
