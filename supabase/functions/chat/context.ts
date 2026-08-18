// chat/context.ts — system-prompt context builders for the chat function
// (P4-1 chat split, cut B). Param-lifted from index.ts; the imported-docs
// fetch, the favourites/non-favourites split, and the env-gated
// webSearchActive flag deliberately STAY in index.ts (the flag reads
// Deno.env per request — module-scoping it would freeze the check at
// cold start). These builders are pure functions of their inputs; every
// string below is LLM-visible prompt framing, byte-preserved from the
// originals and pinned by context.test.ts.

/** Minimal row shapes (the concrete supabase-js row types stay in index). */
export interface DocIndexRow {
  id: string;
  file_name: string;
  summary: string | null;
}
export interface FavouriteDocRow {
  file_name: string;
  extracted_text: string;
}

// Append-ready document index for NON-favourite docs (titles + summaries;
// full text is fetched on demand via the read_imported_document tool).
export function buildDocIndex(nonFavourites: DocIndexRow[]): string {
  let docIndex = `\n\n# IMPORTED DOCUMENTS\n\nThe user has imported the following reference documents into this project. You can see their titles and summaries below. If you need the full text of any document to answer the user's question, use the read_imported_document tool. Only retrieve documents that are directly relevant to the user's query.\n\n`;
  for (const doc of nonFavourites) {
    docIndex += `- Document: "${doc.file_name}" (ID: ${doc.id})\n  Summary: ${doc.summary ?? "No summary available"}\n\n`;
  }
  return docIndex;
}

// Append-ready full-text block for FAVOURITE documents — always available,
// no tool call needed.
export function buildFavBlock(
  favourites: FavouriteDocRow[],
  hasNonFavDocs: boolean,
): string {
  let favBlock = `\n\n# REFERENCE DOCUMENTS (ALWAYS AVAILABLE)\n\nThe following documents have been provided by the user as key reference material. Their full content is included below. Use them to inform your responses without needing to call the read_imported_document tool.\n\n`;
  for (const doc of favourites) {
    favBlock += `=== ${doc.file_name} ===\n\n${doc.extracted_text}\n\n`;
  }
  if (hasNonFavDocs) {
    favBlock += `Note: You also have access to additional imported documents via the read_imported_document tool. Prefer the reference documents above when they contain relevant information; use the tool for the others.\n\n`;
  }
  return favBlock;
}

// Appended to the system prompt when web search is active for the request.
export const WEB_SEARCH_PROMPT = `\n\n# WEB SEARCH

You have access to a web_search tool. Use it according to these rules:

Always search when the user asks about: current events, recent news and developments, anything time-sensitive (prices, scores, weather, standings, elections), specific claims or facts you're not fully confident about, people's current roles or status, or any question where being up-to-date matters.

Never search for: simple conversational messages (greetings, thanks, acknowledgments), questions about well-established facts, concepts, or definitions, requests for creative writing or brainstorming, follow-up questions where the answer is already in the conversation history, or opinions and advice based on general knowledge.

When in doubt, prefer searching - an unnecessary search is better than an outdated answer.

When citing information from web search results, always include the source URL inline in your response text (e.g. "According to [Source Title](URL), ..."). This ensures the user can verify and revisit the sources later.`;
