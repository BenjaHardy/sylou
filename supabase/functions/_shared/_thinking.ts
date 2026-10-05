// ============================================================
// Canonical per-function × per-model adaptive-thinking + effort tables.
//
// Single source of truth, imported via `../_shared/_thinking.ts` by:
//   supabase/functions/analysis/index.ts      (FLOW_THINKING / FLOW_EFFORT / FLOW_MISTRAL_EFFORT)
//   supabase/functions/chat/index.ts          (CHAT_THINKING / CHAT_EFFORT / CHAT_MISTRAL_EFFORT)
//   supabase/functions/editor-action/index.ts (EDITOR_THINKING / EDITOR_EFFORT / EDITOR_MISTRAL_EFFORT)
//   supabase/functions/context-prompt/index.ts (CONTEXT_* for the reply, SUMMARY_* for the writing summary)
//   supabase/functions/extract-text/index.ts  (SUMMARY_THINKING / SUMMARY_EFFORT / SUMMARY_MISTRAL_EFFORT)
//   supabase/functions/_shared/_conversation_memory.ts (the same SUMMARY_* tables)
//
// References:
//   - Thinking:          https://platform.claude.com/docs/en/build-with-claude/thinking
//   - Effort parameter:  https://platform.claude.com/docs/en/build-with-claude/effort
//   - Migration guide:   https://platform.claude.com/docs/en/about-claude/models/migration-guide
//   - Mistral reasoning: https://docs.mistral.ai/capabilities/reasoning/
//
// Claude (verified October 2026):
//   - Effort is sent explicitly even where it equals the API default
//     (high everywhere but Opus 5.5, whose default is medium), so a
//     provider default shift never silently changes a function, and a
//     per-function override is a one-line table edit.
//   - When no `thinking` field is sent, Sonnet 4.6 and Opus 4.8 run
//     WITHOUT thinking. Opus 5.5 and Fable 5.1 think regardless (always
//     on; CLAUDE_ALWAYS_THINKING in _models.ts), and resolveThinking
//     reports them as thinking whatever a table says. Sonnet 5.5's "off"
//     is `between_tools` (effort high or below), spelled by toAnthropicBody.
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
//   `deepseek-v4-flash` (served by DeepSeek-V4.1-Flash) runs in thinking
//   mode by default with its own `thinking` / `reasoning_effort` fields,
//   which Sylou does not send yet. resolveThinking / resolveEffort /
//   resolveMistralEffort all return falsy for DeepSeek so the request body
//   is untouched.
//
// Per-function intent (the cells below are the decisions; only the reasons
// live here):
//   FLOW    — Sonnet 4.6 without thinking: 100% Structured Outputs success.
//             Fable 5.1 at medium: one non-streamed call under the 145 s abort.
//   CHAT / CONTEXT — the 5.5 models and Fable 5.1 at medium (the providers'
//             recommended start); GLM 5.3 at "high" ("max" thinks for a
//             minute or more); Mistral Small at "none" for chat speed.
//   EDITOR / SUMMARY — the lightest level that still answers: low on the
//             thinking Claude models, "low" on GLM 5.3 (it cannot switch
//             reasoning off), off elsewhere.
//
// Regression guardrails (operate against baseline elapsed times
// captured immediately after deploy):
//   * Average FLOW elapsed > 120s on a Claude model across ≥5 runs
//       → drop that model's FLOW_EFFORT one level.
//   * Any single FLOW analysis > 150s wall-clock
//       → roll back this change.
//   * First-attempt Structured Outputs success rate < 90% on Claude
//       → investigate (likely raise the base max_tokens before
//         reducing effort).
//   * Average FLOW elapsed > 100s on Mistral Medium 3.5 across ≥5 runs
//       → flip FLOW_MISTRAL_EFFORT["mistral-medium-3-5"] to "none".
//   * GLM 5.3 is not recommended for FLOW (2026-10 field test:
//     user-leaning scores at every level); it stays at "high" for
//     whoever selects it.
// ============================================================

import {
  CLAUDE_ALWAYS_THINKING,
  CLAUDE_THINKING_OFF_BETWEEN_TOOLS,
  type ClaudeEffort,
  type MistralEffort,
  type OutputBudget,
} from "./_models.ts";

export type { ClaudeEffort, MistralEffort };

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

// Adaptive thinking per model and function. Sonnet 4.6 stays OFF (100%
// Structured Outputs success on FLOW); Opus 5.5 and Fable 5.1 are reported
// as ON by resolveThinking whatever these say (always-on models). Every
// Claude model is listed explicitly in every table (pinned by tests).
export const FLOW_THINKING: ThinkingTable = {
  "claude-sonnet-4-6": false, "claude-sonnet-5-5": true,
  "claude-opus-4-8": true, "claude-opus-5-5": true, "claude-fable-5-1": true,
};
export const CHAT_THINKING: ThinkingTable = {
  "claude-sonnet-4-6": false, "claude-sonnet-5-5": true,
  "claude-opus-4-8": true, "claude-opus-5-5": true, "claude-fable-5-1": true,
};
export const EDITOR_THINKING: ThinkingTable = {
  "claude-sonnet-4-6": false, "claude-sonnet-5-5": true,
  "claude-opus-4-8": true, "claude-opus-5-5": true, "claude-fable-5-1": true,
};
export const CONTEXT_THINKING: ThinkingTable = {
  "claude-sonnet-4-6": false, "claude-sonnet-5-5": true,
  "claude-opus-4-8": true, "claude-opus-5-5": true, "claude-fable-5-1": true,
};
export const SUMMARY_THINKING: ThinkingTable = {
  "claude-sonnet-4-6": false, "claude-sonnet-5-5": true,
  "claude-opus-4-8": false, "claude-opus-5-5": true, "claude-fable-5-1": true,
};

export const FLOW_EFFORT: EffortTable = {
  "claude-sonnet-4-6": "high", "claude-sonnet-5-5": "xhigh",
  "claude-opus-4-8": "high", "claude-opus-5-5": "xhigh", "claude-fable-5-1": "medium",
};
export const CHAT_EFFORT: EffortTable = {
  "claude-sonnet-4-6": "high", "claude-sonnet-5-5": "medium",
  "claude-opus-4-8": "high", "claude-opus-5-5": "medium", "claude-fable-5-1": "medium",
};
export const EDITOR_EFFORT: EffortTable = {
  "claude-sonnet-4-6": "high", "claude-sonnet-5-5": "low",
  "claude-opus-4-8": "high", "claude-opus-5-5": "low", "claude-fable-5-1": "low",
};
export const CONTEXT_EFFORT: EffortTable = {
  "claude-sonnet-4-6": "high", "claude-sonnet-5-5": "medium",
  "claude-opus-4-8": "high", "claude-opus-5-5": "medium", "claude-fable-5-1": "medium",
};
export const SUMMARY_EFFORT: EffortTable = {
  "claude-sonnet-4-6": "high", "claude-sonnet-5-5": "low",
  "claude-opus-4-8": "high", "claude-opus-5-5": "low", "claude-fable-5-1": "low",
};

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
  if (CLAUDE_ALWAYS_THINKING.has(modelId)) return true;
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
  // Reasoning is on when a table or the user asked for it, and always on a
  // model that cannot stop thinking or only pauses it between tool calls.
  const reasoningOn = thinkingOn || mistralEffortOn ||
    CLAUDE_ALWAYS_THINKING.has(modelId) || CLAUDE_THINKING_OFF_BETWEEN_TOOLS.has(modelId);
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

// Claude options: "off" is thinking off at the default effort (between_tools
// on Sonnet 5.5); every other option is adaptive thinking at that effort,
// so the option id doubles as the effort level.
const CLAUDE_OFF: ReasoningOption = { id: "off", thinking: false, effort: "high" };
const claudeLevel = (effort: ClaudeEffort): ReasoningOption => ({ id: effort, thinking: true, effort });
const CLAUDE_LEVELS = (["low", "medium", "high", "xhigh", "max"] as const).map(claudeLevel);

export const CHAT_REASONING_OPTIONS: Readonly<Record<string, readonly ReasoningOption[]>> = {
  "claude-sonnet-4-6": [CLAUDE_OFF, ...(["low", "medium", "high"] as const).map(claudeLevel)],
  "claude-sonnet-5-5": [CLAUDE_OFF, ...CLAUDE_LEVELS],
  "claude-opus-4-8": [CLAUDE_OFF, ...CLAUDE_LEVELS],
  "claude-opus-5-5": CLAUDE_LEVELS,
  "claude-fable-5-1": CLAUDE_LEVELS,
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

/** The fixed settings of the summary calls (document import, conversation
 *  memory, writing summary): resolveReasoning(model, undefined, SUMMARY_TABLES). */
export const SUMMARY_TABLES: ReasoningTables = {
  thinking: SUMMARY_THINKING,
  effort: SUMMARY_EFFORT,
  mistral: SUMMARY_MISTRAL_EFFORT,
};

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
    return {
      thinking: CLAUDE_ALWAYS_THINKING.has(modelId) || (option.thinking ?? false),
      effort: option.effort,
      mistralEffort: undefined,
    };
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
