// analysis/docs-budget.test.ts — tier-boundary pins for the 3-tier
// imported-documents decision (P4-1 Phase D split / P3-7d budget). The
// tier notices are prompt text the scoring model reads. A red test means
// the docs policy changed — checkpoint, not test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type ImportedDocRow, resolveImportedDocs } from "./docs-budget.ts";

const doc = (name: string, text: string | null, summary: string | null): ImportedDocRow => ({
  id: name, file_name: name, extracted_text: text, summary, file_size_bytes: null,
});

Deno.test("no docs → mode none, section 'None', zero chars", () => {
  assertEquals(resolveImportedDocs([], 1000), { section: "None", mode: "none", totalChars: 0 });
});

Deno.test("tier 1: full text ships when it fits the allowance exactly (<=)", () => {
  const d = doc("a.txt", "12345", "sum");
  const entry = "--- a.txt ---\n12345";
  const res = resolveImportedDocs([d], entry.length);
  assertEquals(res.mode, "full_text");
  assertEquals(res.section, entry);
  assertEquals(res.totalChars, 5);
});

Deno.test("tier 2: summaries substitute when full text overflows, with the word-estimate notice", () => {
  const longText = "x".repeat(500);
  const d = doc("a.txt", longText, "short summary");
  const res = resolveImportedDocs([d], 200);
  assertEquals(res.mode, "summaries");
  assertEquals(res.totalChars, 500);
  const words = Math.round(500 / 5).toLocaleString();
  assert(res.section.startsWith(`Note: The full text of imported documents (~${words} words total) exceeded`));
  assert(res.section.includes("--- a.txt ---\nshort summary"));
});

Deno.test("tier 3: exclusion notice lists count and quoted titles (nested-interpolation literal)", () => {
  const d1 = doc("alpha.pdf", "x".repeat(300), "y".repeat(300));
  const d2 = doc("beta.pdf", "x".repeat(300), "y".repeat(300));
  const res = resolveImportedDocs([d1, d2], 100);
  assertEquals(res.mode, "excluded");
  assert(res.section.startsWith("Note: 2 imported document(s)"));
  assert(res.section.includes('The documents\' titles are: "alpha.pdf", "beta.pdf".'));
});

Deno.test("allowance <= 0 lands in the excluded tier even for tiny docs", () => {
  const res = resolveImportedDocs([doc("a.txt", "hi", "h")], -50);
  assertEquals(res.mode, "excluded");
});

Deno.test("missing extracted text ships the placeholder and counts its length", () => {
  const d = doc("scan.pdf", null, null);
  const res = resolveImportedDocs([d], 10_000);
  assertEquals(res.mode, "full_text");
  assert(res.section.includes("--- scan.pdf ---\n(no text extracted)"));
  assertEquals(res.totalChars, "(no text extracted)".length);
});
