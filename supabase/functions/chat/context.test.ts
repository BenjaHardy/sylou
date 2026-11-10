// chat/context.test.ts — byte pins for the LLM-visible system-prompt
// context blocks (P4-1 chat split, cut B). These strings frame what the
// chat model reads about imported documents and web search; a red test
// means the prompt framing changed — checkpoint, not test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildChatMessages, buildDocIndex, buildFavBlock, chatTools } from "./context.ts";

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

Deno.test("doc index for a model that cannot call tools: the summaries only, and no tool named", () => {
  const out = buildDocIndex([{ id: "id-1", file_name: "paper.pdf", summary: "About birds." }], false);
  assert(out.startsWith("\n\n# IMPORTED DOCUMENTS\n\n"));
  assert(out.includes("their full text is not available in this chat"));
  assert(!out.includes("read_imported_document") && !out.includes("(ID:"));
  assert(out.endsWith('- Document: "paper.pdf"\n  Summary: About birds.\n\n'));
});

Deno.test("chat messages: system prompt, memory in the user zone, the verbatim window, the trimmed message", () => {
  const memory = { summary_text: "The plan so far.", covers_through: "t", covered_message_count: 4, updated_at: "" };
  const messages = buildChatMessages("SYSTEM", memory, [{ role: "assistant", content: "Earlier." }], "  Next?  ");
  assertEquals(messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
  assertEquals(messages[0].content, "SYSTEM");
  assert(String(messages[1].content).startsWith("[CONVERSATION MEMORY]"));
  assert(String(messages[1].content).includes("The plan so far."));
  assertEquals(messages.slice(2), [{ role: "assistant", content: "Earlier." }, { role: "user", content: "Next?" }]);
  assertEquals(buildChatMessages("SYSTEM", null, [], "Hi").map((m) => m.role), ["system", "user"]);
});

Deno.test("chat tools: the document tool first, then web search, each only when asked for", () => {
  assertEquals(chatTools(true, true).map((t) => t.function.name), ["read_imported_document", "web_search"]);
  assertEquals(chatTools(false, true).map((t) => t.function.name), ["web_search"]);
  assertEquals(chatTools(false, false), []);
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
