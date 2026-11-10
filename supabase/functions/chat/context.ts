// chat/context.ts — system-prompt context builders for the chat function
// (P4-1 chat split, cut B). Param-lifted from index.ts; the imported-docs
// fetch, the favourites/non-favourites split, and the env-gated
// webSearchActive flag deliberately STAY in index.ts (the flag reads
// Deno.env per request — module-scoping it would freeze the check at
// cold start). These builders are pure functions of their inputs; every
// string below is LLM-visible prompt framing, byte-preserved from the
// originals and pinned by context.test.ts.

import type { LLMMessage, LLMTool } from "../_shared/_llm.ts";
import { buildDocumentTool, buildWebSearchTool } from "../_shared/_tools.ts";
import {
  buildMemoryInjection,
  type ConversationMemoryRow,
  type VerbatimMessage,
} from "../_shared/_conversation_memory.ts";
import { documentRow, favouriteEntry } from "../_shared/_favourites.ts";

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
// `canRead` false: a local model that cannot call tools.
export function buildDocIndex(nonFavourites: DocIndexRow[], canRead = true): string {
  let docIndex = canRead
    ? `\n\n# IMPORTED DOCUMENTS\n\nThe user has imported the following reference documents into this project. You can see their titles and summaries below. If you need the full text of any document to answer the user's question, use the read_imported_document tool. Only retrieve documents that are directly relevant to the user's query.\n\n`
    : `\n\n# IMPORTED DOCUMENTS\n\nThe user has imported the following reference documents into this project. You can see their titles and summaries below; their full text is not available in this chat.\n\n`;
  for (const doc of nonFavourites) {
    docIndex += documentRow(doc, canRead);
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
    favBlock += favouriteEntry(doc);
  }
  if (hasNonFavDocs) {
    favBlock += `Note: You also have access to additional imported documents via the read_imported_document tool. Prefer the reference documents above when they contain relevant information; use the tool for the others.\n\n`;
  }
  return favBlock;
}

/** A chat call's messages: the system prompt, the conversation memory if
 *  the thread has one, the verbatim window, then the new message. The memory
 *  sits in the user zone, deliberately never the system prompt: it is
 *  condensed USER conversation and must stay exactly as privileged as the raw
 *  messages it summarizes. */
export function buildChatMessages(
  systemPrompt: string,
  memory: ConversationMemoryRow | null,
  history: VerbatimMessage[],
  message: string,
): LLMMessage[] {
  return [
    { role: "system", content: systemPrompt },
    ...(memory ? [{ role: "user" as const, content: buildMemoryInjection(memory.summary_text) }] : []),
    ...history.map((m): LLMMessage => ({
      role: m.role as LLMMessage["role"],
      content: m.content,
    })),
    { role: "user", content: message.trim() },
  ];
}

/** The tools a chat call offers, in this order. */
export function chatTools(documents: boolean, webSearch: boolean): LLMTool[] {
  const tools: LLMTool[] = [];
  if (documents) tools.push(buildDocumentTool());
  if (webSearch) tools.push(buildWebSearchTool());
  return tools;
}
