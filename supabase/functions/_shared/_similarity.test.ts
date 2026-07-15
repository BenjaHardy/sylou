// Deno unit tests for the FLOW similarity measure (P3-7d).
// Run with: deno test supabase/functions/_shared/_similarity.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  computeSimilarityPct,
  ngrams,
  normalise,
  stripHtmlForSimilarity,
} from "./_similarity.ts";

// --- stripHtmlForSimilarity ---

Deno.test("tags are replaced with spaces, not removed (no word gluing)", () => {
  const stripped = stripHtmlForSimilarity("<p>alpha</p><p>beta</p>");
  assertEquals(normalise(stripped), "alpha beta");
});

Deno.test("common TipTap entities are decoded", () => {
  const stripped = stripHtmlForSimilarity("rock&nbsp;&amp;&nbsp;roll &lt;3 &quot;live&quot;");
  assertEquals(normalise(stripped), "rock roll 3 live");
});

Deno.test("double-encoded text decodes exactly once", () => {
  // User typed a literal "&lt;" — stored as "&amp;lt;". Must come back as
  // "&lt;", not decode twice into "<".
  assertEquals(stripHtmlForSimilarity("&amp;lt;"), "&lt;");
});

// --- ngrams ---

Deno.test("ngrams slides a window over words", () => {
  assertEquals(
    [...ngrams("one two three four five six", 5)],
    ["one two three four five", "two three four five six"],
  );
});

Deno.test("ngrams of text shorter than n is empty", () => {
  assertEquals(ngrams("one two", 5).size, 0);
});

// --- computeSimilarityPct ---

Deno.test("HTML-wrapped writing matches its plain-text chat source (the P3-7d bug)", () => {
  // Before the fix, normalise("<p>The moon ... tonight.</p>") produced
  // "pthe moon ... tonightp": the edge 5-grams never matched and this
  // clear-cut copy scored 33 instead of 100.
  const pct = computeSimilarityPct(
    "<p>The moon rose over the hills tonight.</p>",
    ["The moon rose over the hills tonight."],
  );
  assertEquals(pct, 100);
});

Deno.test("5-grams spanning a paragraph boundary still match", () => {
  // Tags→spaces is load-bearing here: tags→"" would glue "epsilonzeta" and
  // lose every cross-boundary gram.
  const pct = computeSimilarityPct(
    "<p>alpha beta gamma delta epsilon</p><p>zeta eta theta iota kappa</p>",
    ["alpha beta gamma delta epsilon zeta eta theta iota kappa"],
  );
  assertEquals(pct, 100);
});

Deno.test("entity-laden writing matches its plain source", () => {
  const pct = computeSimilarityPct(
    "<p>rock&nbsp;&amp;&nbsp;roll forever tonight my friends</p>",
    ["rock & roll forever tonight my friends"],
  );
  assertEquals(pct, 100);
});

Deno.test("partial overlap is proportional to matching writing 5-grams", () => {
  // 10 writing words → 6 five-grams; only the first gram appears in chat.
  const pct = computeSimilarityPct(
    "<p>one two three four five six seven eight nine ten</p>",
    ["one two three four five"],
  );
  assertEquals(pct, 17); // round(1/6 × 100)
});

Deno.test("disjoint texts score 0", () => {
  const pct = computeSimilarityPct(
    "<p>alpha beta gamma delta epsilon</p>",
    ["one two three four five"],
  );
  assertEquals(pct, 0);
});

Deno.test("empty writing, markup-only writing and absent messages score 0", () => {
  assertEquals(computeSimilarityPct("", ["one two three four five"]), 0);
  assertEquals(computeSimilarityPct("<p></p><hr>", ["one two three four five"]), 0);
  assertEquals(computeSimilarityPct("<p>one two three four five</p>", []), 0);
});
