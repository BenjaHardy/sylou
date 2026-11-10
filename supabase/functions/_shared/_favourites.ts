// Favourite documents beside a local model's window (chat and editor-action).
// A cloud model always gets every favourite's full text. A local model gets
// those that fit its window, and the stored summary
// (imported_documents.summary) of the others.

import { estimateTokens } from "./_fit.ts";

export interface FavouriteDoc {
  id: string;
  file_name: string;
  extracted_text: string;
  summary: string | null;
}

/** A favourite's entry in a full-text block. */
export function favouriteEntry(doc: Pick<FavouriteDoc, "file_name" | "extracted_text">): string {
  return `=== ${doc.file_name} ===\n\n${doc.extracted_text}\n\n`;
}

/** A document's row in a list of summaries; the id only when the model can
 *  read the document with the read_imported_document tool. */
export function documentRow(doc: Pick<FavouriteDoc, "id" | "file_name" | "summary">, withId: boolean): string {
  return `- Document: "${doc.file_name}"${withId ? ` (ID: ${doc.id})` : ""}\n  Summary: ${doc.summary ?? "No summary available"}\n\n`;
}

/** The favourites whose entries fit `roomTokens` whole, taken in listed
 *  order, and the others. */
export function splitFavourites<T extends FavouriteDoc>(docs: T[], roomTokens: number): { whole: T[]; summarized: T[] } {
  const whole: T[] = [];
  const summarized: T[] = [];
  let left = roomTokens;
  for (const doc of docs) {
    const tokens = estimateTokens(favouriteEntry(doc));
    if (tokens <= left) {
      whole.push(doc);
      left -= tokens;
    } else {
      summarized.push(doc);
    }
  }
  return { whole, summarized };
}

/** The block for the favourites given as their summaries. `canRead`: the
 *  model can read their full text with the read_imported_document tool. */
export function buildSummarizedFavBlock(docs: FavouriteDoc[], canRead: boolean): string {
  const how = canRead
    ? "Their summaries are below; read the full text of one with the read_imported_document tool when you need it."
    : "Only their summaries are below.";
  let block = `\n\n# REFERENCE DOCUMENTS TOO LONG TO INCLUDE\n\nThe user also marked these documents as key reference material, but their full text does not fit beside this request. ${how}\n\n`;
  for (const doc of docs) block += documentRow(doc, canRead);
  return block;
}
