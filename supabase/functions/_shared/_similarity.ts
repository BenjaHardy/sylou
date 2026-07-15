// Deterministic writing↔AI-chat overlap measure feeding the FLOW Write
// pillar. Extracted from analysis/index.ts (P3-7d) so the n-gram pipeline is
// unit-testable; the ≥35% Write-score cap that consumes the result stays in
// the analysis handler.
//
// The writing side arrives as TipTap HTML (literal `<` typed by the user is
// entity-escaped there, so every bare `<...>` really is markup); assistant
// messages are markdown and are deliberately NOT tag-stripped — prose like
// "x < 5 and y > 3" would be eaten by the tag regex.

/**
 * Reduce TipTap HTML to comparable plain text: tags become spaces so words
 * on either side of an element boundary don't glue together
 * (`...e</p><p>f...` must yield "e f", never "ef"), then the entities TipTap
 * commonly emits are decoded (`&amp;` last, so double-encoded text decodes
 * exactly once). Whitespace is left uncollapsed — normalise() handles that.
 */
export function stripHtmlForSimilarity(html: string): string {
  if (!html) return "";
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&");
}

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ngrams(text: string, n: number): Set<string> {
  const words = text.split(" ");
  const out = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    out.add(words.slice(i, i + n).join(" "));
  }
  return out;
}

/**
 * Percentage (0–100, rounded) of the writing's 5-grams that also occur in
 * any assistant chat message. The writing is HTML-stripped before
 * comparison — tag fragments used to pollute the writing-side n-grams
 * (`<p>Hello` normalised to "phello"), breaking matches at every element
 * boundary and undercounting real overlap.
 */
export function computeSimilarityPct(
  writingHtml: string,
  assistantMessages: string[],
): number {
  const normWriting = normalise(stripHtmlForSimilarity(writingHtml));
  if (!normWriting) return 0;

  const assistantNgrams = new Set<string>();
  for (const msg of assistantMessages) {
    const normMsg = normalise(msg);
    for (const ng of ngrams(normMsg, 5)) {
      assistantNgrams.add(ng);
    }
  }

  if (assistantNgrams.size === 0) return 0;

  const writingNgramsList = ngrams(normWriting, 5);
  if (writingNgramsList.size === 0) return 0;

  let matchCount = 0;
  for (const ng of writingNgramsList) {
    if (assistantNgrams.has(ng)) matchCount++;
  }

  return Math.round((matchCount / writingNgramsList.size) * 100);
}
