// Server-side request-validation constants for the LLM edge functions:
// the model allowlist and the user-input size ceilings (audit P2-6 / F4+F5).

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
