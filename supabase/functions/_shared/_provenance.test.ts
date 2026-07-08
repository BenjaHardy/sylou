// Deno unit tests for annotateWritingWithProvenance.
// Run with: deno test supabase/functions/_shared/_provenance.test.ts
//
// Position bookkeeping in fixtures (ProseMirror semantics):
//   block open/close (<p>, <ul>, <li>, ...) = 1 position each
//   leaf (<br>, <hr>) = 1 position
//   text char / entity = 1 position
//   inline mark tags (<strong>, <span>, ...) = 0 positions
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { annotateWritingWithProvenance } from "./_provenance.ts";

Deno.test("no segments: whole content prefixed [t]", () => {
  assertEquals(annotateWritingWithProvenance("<p>Hi</p>", []), "[t]<p>Hi</p>");
});

Deno.test("single typed segment covering the whole doc", () => {
  // <p>Hi</p>: p=0→1, H=1, i=2, /p=3→4 → doc size 4
  assertEquals(
    annotateWritingWithProvenance("<p>Hi</p>", [{ start: 0, end: 4, source: "typed" }]),
    "[t]<p>Hi</p>",
  );
});

Deno.test("the drift case: marker lands at the paragraph boundary, not mid-word", () => {
  // <p>Hello world</p>: p=0→1, 11 chars=1..12, /p=12→13
  // <p>AI text</p>:     p=13→14, 7 chars=14..21, /p=21→22
  const html = "<p>Hello world</p><p>AI text</p>";
  const segs = [
    { start: 0, end: 13, source: "typed" },
    { start: 13, end: 22, source: "ai_editor" },
  ];
  // Legacy string-slicing emitted "…Hello worl[ai]d</p>…" here.
  assertEquals(
    annotateWritingWithProvenance(html, segs),
    "[t]<p>Hello world</p>[ai]<p>AI text</p>",
  );
});

Deno.test("inline marks cost 0 positions; markers hug the text", () => {
  // <p>a <strong>bold</strong> z</p>:
  // p=0→1, a=1, ' '=2, b..d=3..6 (strong is a mark), ' '=7, z=8, /p=9→10
  const html = "<p>a <strong>bold</strong> z</p>";
  const segs = [
    { start: 0, end: 3, source: "typed" },
    { start: 3, end: 7, source: "ai_editor" },
    { start: 7, end: 10, source: "typed" },
  ];
  assertEquals(
    annotateWritingWithProvenance(html, segs),
    "[t]<p>a <strong>[ai]bold</strong>[t] z</p>",
  );
});

Deno.test("HTML entities count as one position and are emitted verbatim", () => {
  // <p>A &amp; B</p>: p=0→1, A=1, ' '=2, &=3 (one entity), ' '=4, B=5, /p=6→7
  const html = "<p>A &amp; B</p>";
  const segs = [
    { start: 0, end: 3, source: "typed" },
    { start: 3, end: 7, source: "ai_editor" },
  ];
  assertEquals(annotateWritingWithProvenance(html, segs), "[t]<p>A [ai]&amp; B</p>");
});

Deno.test("nested list structure: every block level costs positions", () => {
  // <ul><li><p>x</p></li></ul>: ul=0→1, li=1→2, p=2→3, x=3, /p=4→5, /li=5→6, /ul=6→7
  const html = "<ul><li><p>x</p></li></ul>";
  const segs = [
    { start: 0, end: 3, source: "typed" },
    { start: 3, end: 7, source: "ai_editor" },
  ];
  assertEquals(
    annotateWritingWithProvenance(html, segs),
    "[t]<ul><li><p>[ai]x</p></li></ul>",
  );
});

Deno.test("hard break is a leaf node costing one position", () => {
  // <p>a<br>b</p>: p=0→1, a=1, br=2, b=3, /p=4→5
  const html = "<p>a<br>b</p>";
  const segs = [
    { start: 0, end: 3, source: "typed" },
    { start: 3, end: 5, source: "ai_editor" },
  ];
  assertEquals(annotateWritingWithProvenance(html, segs), "[t]<p>a<br>[ai]b</p>");
});

Deno.test("untracked trailing region gets a [t] marker", () => {
  const html = "<p>Hello world</p><p>AI text</p>";
  const segs = [{ start: 0, end: 13, source: "ai_editor" }];
  assertEquals(
    annotateWritingWithProvenance(html, segs),
    "[ai]<p>Hello world</p>[t]<p>AI text</p>",
  );
});

Deno.test("chat_ai and external map to [cc] and [ce]; leading gap gets [t]", () => {
  // <p>abcd</p>: p=0→1, a=1, b=2, c=3, d=4, /p=5→6
  const html = "<p>abcd</p>";
  const segs = [
    { start: 1, end: 3, source: "chat_ai" },
    { start: 3, end: 5, source: "external" },
  ];
  // Trailing [t] lands before the close tag: positions 5..6 (the block
  // boundary) are past the last segment. Only reachable with stale/short
  // segment data — real tracker data always spans the full doc size.
  assertEquals(
    annotateWritingWithProvenance(html, segs),
    "[t]<p>[cc]ab[ce]cd[t]</p>",
  );
});

Deno.test("segment boundaries beyond the document are dropped, never garbled", () => {
  const html = "<p>Hi</p>"; // doc size 4
  const segs = [
    { start: 0, end: 4, source: "typed" },
    { start: 4, end: 999, source: "ai_editor" },
  ];
  // Legacy slicing emitted "[ai]" + garbage sliced from tag characters here.
  assertEquals(annotateWritingWithProvenance(html, segs), "[t]<p>Hi</p>");
});

Deno.test("markers never split an HTML tag, even with mid-tag legacy offsets", () => {
  const html = "<p>Hi</p>"; // doc size 4
  // A boundary at position 2 falls between 'H' and 'i' in position space.
  // Legacy behavior sliced the STRING at 2 → "[t]<p[t]>Hi</p>" (split tag).
  const segs = [{ start: 0, end: 2, source: "typed" }];
  assertEquals(annotateWritingWithProvenance(html, segs), "[t]<p>H[t]i</p>");
});

Deno.test("unknown tags are treated as marks (0 positions), no crash", () => {
  // <p><mark>x</mark></p>: p=0→1, x=1, /p=2→3 (mark = unknown → 0)
  const html = "<p><mark>x</mark></p>";
  const segs = [{ start: 0, end: 3, source: "typed" }];
  assertEquals(annotateWritingWithProvenance(html, segs), "[t]<p><mark>x</mark></p>");
});

Deno.test("empty content with segments yields empty output", () => {
  assertEquals(
    annotateWritingWithProvenance("", [{ start: 0, end: 4, source: "typed" }]),
    "",
  );
});

Deno.test("attributes with raw '>' inside quotes do not truncate the tag", () => {
  // p=0→1, x=1 (a is a mark), /p=2→3
  const html = '<p><a href="https://x.test/a>b">x</a></p>';
  const segs = [{ start: 0, end: 3, source: "typed" }];
  assertEquals(
    annotateWritingWithProvenance(html, segs),
    '[t]<p><a href="https://x.test/a>b">x</a></p>',
  );
});
