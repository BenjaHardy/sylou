// chat/context.test.ts — byte pins for the LLM-visible system-prompt
// context blocks (P4-1 chat split, cut B). These strings frame what the
// chat model reads about imported documents and web search; a red test
// means the prompt framing changed — checkpoint, not test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDocIndex, buildFavBlock, WEB_SEARCH_PROMPT } from "./context.ts";

Deno.test("doc index: header, per-doc rows, and the missing-summary fallback", () => {
  const out = buildDocIndex([
    { id: "id-1", file_name: "paper.pdf", summary: "About birds." },
    { id: "id-2", file_name: "notes.txt", summary: null },
  ]);
  assert(out.startsWith("\n\n# IMPORTED DOCUMENTS\n\n"));
  assert(out.includes("use the read_imported_document tool"));
  assert(out.includes('- Document: "paper.pdf" (ID: id-1)\n  Summary: About birds.\n\n'));
  assert(out.includes('- Document: "notes.txt" (ID: id-2)\n  Summary: No summary available\n\n'));
});

Deno.test("favourites block: header, fenced full text, and the conditional tool note", () => {
  const docs = [{ file_name: "style.md", extracted_text: "Write plainly." }];
  const withNote = buildFavBlock(docs, true);
  assert(withNote.startsWith("\n\n# REFERENCE DOCUMENTS (ALWAYS AVAILABLE)\n\n"));
  assert(withNote.includes("=== style.md ===\n\nWrite plainly.\n\n"));
  assert(withNote.includes("Note: You also have access to additional imported documents"));
  const withoutNote = buildFavBlock(docs, false);
  assert(!withoutNote.includes("Note: You also have access"));
});

Deno.test("web-search block: leading separator, rules, and the deliberate ASCII hyphen", () => {
  assert(WEB_SEARCH_PROMPT.startsWith("\n\n# WEB SEARCH"));
  assert(WEB_SEARCH_PROMPT.includes("Always search when the user asks about"));
  assert(WEB_SEARCH_PROMPT.includes("Never search for"));
  // ASCII hyphen here is deliberate typography, not a typo — do not "fix".
  assert(WEB_SEARCH_PROMPT.includes(
    "prefer searching - an unnecessary search is better than an outdated answer",
  ));
  assert(WEB_SEARCH_PROMPT.includes("always include the source URL inline"));
  // The model is told the loop's limits up front (5 rounds, 5 calls per round).
  assert(WEB_SEARCH_PROMPT.includes("up to 5 rounds per reply, and at most 5 tool calls run per round"));
});

Deno.test("builders return empty-input shells rather than throwing", () => {
  const emptyIndex = buildDocIndex([]);
  assert(emptyIndex.startsWith("\n\n# IMPORTED DOCUMENTS"));
  assertEquals(buildFavBlock([], false).includes("==="), false);
});
