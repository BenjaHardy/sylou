// Deno unit tests for favourite documents beside a local model's window:
// which go in whole, and the block for the others' summaries.
// Run with: deno test supabase/functions/_shared/_favourites.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildSummarizedFavBlock, documentRow, favouriteEntry, splitFavourites } from "./_favourites.ts";
import { estimateTokens } from "./_fit.ts";

const doc = (id: string, chars: number, summary: string | null = `About ${id}.`) => ({
  id,
  file_name: `${id}.md`,
  extracted_text: "x".repeat(chars),
  summary,
});

Deno.test("favouriteEntry: the file name fenced above its full text", () => {
  assertEquals(favouriteEntry(doc("style", 3)), "=== style.md ===\n\nxxx\n\n");
});

Deno.test("documentRow: name, summary and, for a model that can read it, the id", () => {
  assertEquals(documentRow(doc("d-1", 1), true), '- Document: "d-1.md" (ID: d-1)\n  Summary: About d-1.\n\n');
  assertEquals(documentRow(doc("d-1", 1, null), false), '- Document: "d-1.md"\n  Summary: No summary available\n\n');
});

Deno.test("splitFavourites: whole while they fit, in listed order; a later smaller one can still fit", () => {
  const [a, big, b] = [doc("a", 300), doc("big", 3_000), doc("b", 300)];
  const room = estimateTokens(favouriteEntry(a)) + estimateTokens(favouriteEntry(b));
  const { whole, summarized } = splitFavourites([a, big, b], room);
  assertEquals(whole.map((d) => d.id), ["a", "b"]);
  assertEquals(summarized.map((d) => d.id), ["big"]);
});

Deno.test("splitFavourites: no room puts every favourite in the summaries", () => {
  const { whole, summarized } = splitFavourites([doc("a", 10), doc("b", 10)], -5);
  assertEquals(whole, []);
  assertEquals(summarized.map((d) => d.id), ["a", "b"]);
});

Deno.test("buildSummarizedFavBlock: the summaries, and the tool for the full text when the model can call it", () => {
  const readable = buildSummarizedFavBlock([doc("big", 5_000)], true);
  assert(readable.startsWith("\n\n# REFERENCE DOCUMENTS TOO LONG TO INCLUDE\n\n"), readable);
  assert(readable.includes("read the full text of one with the read_imported_document tool"), readable);
  assert(readable.endsWith('- Document: "big.md" (ID: big)\n  Summary: About big.\n\n'), readable);
  assert(!readable.includes("xxx"), "never the full text");

  const summariesOnly = buildSummarizedFavBlock([doc("big", 5_000)], false);
  assert(summariesOnly.includes("Only their summaries are below."), summariesOnly);
  assert(!summariesOnly.includes("read_imported_document") && !summariesOnly.includes("(ID:"), summariesOnly);
});
