// Client-side mirror of the server's selection and output limits for the
// AI selection window (editor actions, Ask, Propose).
//
// Sources of truth live server-side in supabase/functions/_shared/_models.ts:
// INPUT_LIMITS.SELECTED_TEXT_CHARS (the request is rejected above it) and
// OUTPUT_BUDGETS.EDITOR_ACTION_TOKENS (the max_tokens base of an editor
// action). Keep the two in sync — the numbers here only decide when the
// window warns; the server still enforces.
//
// Why warn at all: an editor action rewrites the selection roughly 1:1
// (Expand grows it), so a selection longer than the output budget yields a
// reply the provider cuts off at max_tokens. The server flags such replies
// (`truncated` on the done event) and Accept asks for confirmation; this
// module lets the window say so BEFORE the request is made.

/** Hard cap on selected text (characters); the server answers 400 beyond it. */
export const SELECTED_TEXT_MAX_CHARS = 50_000;

/** max_tokens base of an editor action (reasoning models get headroom on
 *  top, which their thinking consumes — the visible reply stays ~this). */
export const EDITOR_ACTION_OUTPUT_TOKENS = 1_000;

const CHARS_PER_TOKEN = 4;

/** Rough character equivalent of the editor-action output budget. */
export const EDITOR_ACTION_OUTPUT_CHARS = EDITOR_ACTION_OUTPUT_TOKENS * CHARS_PER_TOKEN;

/** Selections beyond this length get the large-selection notice; kept
 *  under the budget because a rewrite is rarely shorter than its input. */
export const LARGE_SELECTION_CHARS = Math.round(EDITOR_ACTION_OUTPUT_CHARS * 0.85);

export type SelectionSize = "ok" | "large" | "too-long";

export function assessSelectionSize(chars: number): SelectionSize {
  if (chars > SELECTED_TEXT_MAX_CHARS) return "too-long";
  if (chars > LARGE_SELECTION_CHARS) return "large";
  return "ok";
}
