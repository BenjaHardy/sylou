// Server-side request-validation constants for the LLM edge functions:
// the model allowlist, the user-input size ceilings (audit P2-6 / F4+F5)
// and the per-model context-window mirror (P3-7d).

/**
 * Models a request may select via the optional `model` body field.
 *
 * Mirror of the frontend registry (`src/lib/models.ts`) — edge functions
 * cannot import frontend modules, so the ids are duplicated deliberately.
 * KEEP IN SYNC when adding or removing a model (see the checklist in
 * docs/model-configuration.md).
 *
 * Why: chat, editor-action and context-prompt accept a `model` override in
 * the request body. The shipped client never sends it, but any authenticated
 * caller can — and without this gate the string went verbatim to the provider
 * on the operator's API key (any model the key can access, at any price).
 * An absent/empty value is NOT gated: the functions fall back to the user's
 * profile preference, exactly as before.
 */
export const ALLOWED_MODELS: ReadonlySet<string> = new Set([
  "mistral-small-2603",
  "mistral-medium-3-5",
  "mistral-large-2512",
  "zai-glm-5-3",
  "claude-sonnet-4-6",
  "claude-sonnet-5-5",
  "claude-opus-4-8",
  "claude-opus-5-5",
  "claude-fable-5-1",
  "deepseek-v4-flash",
]);

/**
 * Claude models whose thinking cannot be turned off: the API runs adaptive
 * thinking when the field is omitted and rejects "disabled". resolveThinking
 * (_thinking.ts) reports them as thinking whatever a table says, so the
 * reasoning ceiling always applies, and the picker never offers "Off".
 */
export const CLAUDE_ALWAYS_THINKING: ReadonlySet<string> = new Set([
  "claude-opus-5-5",
  "claude-fable-5-1",
]);

/**
 * Claude models where "thinking off" is spelled `thinking: {type: "between_tools"}`
 * ("disabled" is a 400): no up-front thinking, progress notes between tool
 * calls only; accepted at effort high or below. Spelled by toAnthropicBody.
 */
export const CLAUDE_THINKING_OFF_BETWEEN_TOOLS: ReadonlySet<string> = new Set([
  "claude-sonnet-5-5",
]);

/** Reasoning-depth vocabularies, provider-specific. Claude: `output_config.effort`
 *  (Sonnet 4.6 stops at high; the others go to max). Mistral API:
 *  `reasoning_effort` ("high" | "none" on Mistral's own models, "low" |
 *  "high" | "max" on GLM 5.3). */
export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";
export type MistralEffort = "low" | "high" | "max" | "none";

/**
 * Per-request ceilings for user-supplied text fields, in characters
 * (~4 chars ≈ 1 token). Generous multiples of anything the shipped UI can
 * produce — these bound direct-API abuse (provider-cost amplification and
 * giant persisted rows that then ride along in later context assembly);
 * they are not UX limits and no legitimate request should ever hit them.
 */
export const INPUT_LIMITS = {
  /** chat: body.message (~8K tokens — a very long chat message). */
  CHAT_MESSAGE_CHARS: 32_000,
  /** editor-action + context-prompt: body.selected_text (~a 20-page selection). */
  SELECTED_TEXT_CHARS: 50_000,
  /** context-prompt: body.instruction (~two pages of prompt). */
  INSTRUCTION_CHARS: 5_000,
  /** Short label-ish fields: selected_text_source, target_language. */
  SHORT_FIELD_CHARS: 200,
} as const;

/** One output ceiling per call shape: `plain` when the model answers
 *  without reasoning, `reasoning` when thinking / reasoning_effort is on
 *  (reasoning tokens are billed against the same max_tokens, so the
 *  visible reply keeps roughly the plain budget). */
export interface OutputBudget {
  plain: number;
  reasoning: number;
}

/**
 * Output budgets (max_tokens ceilings) per LLM call shape — the ONE place
 * these numbers live server-side; resolveMaxTokens in _thinking.ts picks
 * the applicable member. Ceilings, not targets: a reply stops when the
 * model is done, so a ceiling costs nothing until it is hit. A reasoning
 * model's thinking counts against the same ceiling as its answer, which is
 * why the `reasoning` member is several times the `plain` one — an
 * exhausted ceiling leaves no answer text at all ("No response generated").
 * The reasoning ceilings suit a Pro plan's 400 s wall clock at the
 * ~300 tokens/s observed on GLM 5.3; a "max" think can outrun the free
 * plan's 150 s, hence the "Max (slow)" label in the picker. The client
 * mirrors EDITOR_ACTION.plain in src/lib/editor-limits.ts to warn before an
 * editor action whose reply would not fit — keep the two in sync.
 */
export const OUTPUT_BUDGETS = {
  /** chat: one assistant turn (also the two-pass and tool-loop calls). */
  CHAT: { plain: 4_000, reasoning: 24_000 },
  /** context-prompt: the Ask/Propose response call. */
  CONTEXT_RESPONSE: { plain: 4_000, reasoning: 24_000 },
  /** context-prompt: the writing-summary call. */
  CONTEXT_SUMMARY: { plain: 2_000, reasoning: 4_000 },
  /** editor-action: one inline rewrite of the selection. */
  EDITOR_ACTION: { plain: 4_000, reasoning: 6_000 },
  /** analysis: the FLOW report (Structured Outputs / forced tool call) —
   *  one non-streamed call under a 145 s abort, so ~80 s of generation;
   *  a truncated attempt is not retried (attempt.ts). */
  FLOW: { plain: 8_192, reasoning: 24_000 },
  /** extract-text: the 3–5 sentence summary of an imported document. */
  DOC_SUMMARY: { plain: 500, reasoning: 2_000 },
  /** _conversation_memory: the rolling per-thread chat summary. */
  MEMORY: { plain: 3_000, reasoning: 6_000 },
} as const satisfies Record<string, OutputBudget>;

/**
 * Context-window size (input tokens) per allowed model.
 *
 * Same mirror-of-the-frontend-registry discipline as ALLOWED_MODELS above
 * (`contextLimit` in src/lib/models.ts is the source of truth) — KEEP IN
 * SYNC when adding or removing a model (checklist in
 * docs/model-configuration.md).
 *
 * Consumed by `analysis` to fit the imported-documents budget to the model
 * actually running the FLOW analysis, and to disclose the real window in
 * `flow_meta.context_limit_tokens` (previously hardcoded to 1M regardless
 * of model, which skewed the report's token-usage panel).
 */
export const CONTEXT_LIMIT_TOKENS: Readonly<Record<string, number>> = {
  "mistral-small-2603": 256_000,
  "mistral-medium-3-5": 256_000,
  "mistral-large-2512": 256_000,
  "zai-glm-5-3": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-sonnet-5-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-opus-5-5": 1_000_000,
  "claude-fable-5-1": 1_000_000,
  "deepseek-v4-flash": 1_000_000,
};

/**
 * Conservative fallback when a model id isn't in the table (e.g. a stale
 * legacy id still stored as a profile preference). Mirrors the client's
 * DEFAULT_CONTEXT_LIMIT posture in src/lib/estimateTokens.ts: an unknown
 * model under-budgets, never over.
 */
export const FALLBACK_CONTEXT_LIMIT_TOKENS = 200_000;
