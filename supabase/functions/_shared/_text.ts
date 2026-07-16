// Small shared text utilities for the edge functions (P3-7e).

/**
 * `str.slice(0, end)` that never cuts a surrogate pair in half.
 *
 * JS strings are UTF-16: astral characters (emoji, rare CJK ideographs, …)
 * occupy two code units, and a blind `.slice()` boundary can strand the
 * leading half. The resulting lone surrogate is not valid Unicode — when the
 * string later lands in a Postgres text/jsonb column the whole insert is
 * rejected (observed class: truncated previews in ai_editor_actions,
 * extract-text summaries, chat snippets — failing on an emoji at exactly
 * the truncation offset, sometimes after the LLM spend).
 * If the last kept unit is a high surrogate, one more unit is dropped.
 */
export function sliceSafe(str: string, end: number): string {
  const cut = str.slice(0, end);
  if (cut.length === 0 || cut.length === str.length) return cut;
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
