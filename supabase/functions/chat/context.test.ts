// chat/context.test.ts — byte pins for the LLM-visible system-prompt
// context blocks (P4-1 chat split, cut B). These strings frame what the
// chat model reads about imported documents and web search; a red test
// means the prompt framing changed — checkpoint, not test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildDocIndex, buildFavBlock } from "./context.ts";

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

Deno.test("builders return empty-input shells rather than throwing", () => {
  const emptyIndex = buildDocIndex([]);
  assert(emptyIndex.startsWith("\n\n# IMPORTED DOCUMENTS"));
  assertEquals(buildFavBlock([], false).includes("==="), false);
});
