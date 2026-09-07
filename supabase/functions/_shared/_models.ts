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
  "zai-glm-5-2",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "deepseek-v4-flash",
]);

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

/**
 * Output budgets (max_tokens bases) for the short-form LLM functions —
 * the ONE place these numbers live server-side; resolveMaxTokens in
 * _thinking.ts adds reasoning headroom on top. The client mirrors
 * EDITOR_ACTION_TOKENS in src/lib/editor-limits.ts to warn before an
 * editor action whose reply would not fit — keep the two in sync.
 */
export const OUTPUT_BUDGETS = {
  /** editor-action: one inline rewrite of the selection. */
  EDITOR_ACTION_TOKENS: 1_000,
  /** context-prompt: the Ask/Propose response call. */
  CONTEXT_RESPONSE_TOKENS: 2_000,
  /** context-prompt: the writing-summary call. */
  CONTEXT_SUMMARY_TOKENS: 1_000,
} as const;

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
  "zai-glm-5-2": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "deepseek-v4-flash": 1_000_000,
};

/**
 * Conservative fallback when a model id isn't in the table (e.g. a stale
 * legacy id still stored as a profile preference). Mirrors the client's
 * DEFAULT_CONTEXT_LIMIT posture in src/lib/estimateTokens.ts: an unknown
 * model under-budgets, never over.
 */
export const FALLBACK_CONTEXT_LIMIT_TOKENS = 200_000;
