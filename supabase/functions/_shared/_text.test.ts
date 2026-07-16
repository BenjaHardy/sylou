// Deno unit tests for the shared text utilities (P3-7e).
// Run with: deno test supabase/functions/_shared/_text.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sliceSafe } from "./_text.ts";

const ENDS_IN_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;

Deno.test("plain ASCII truncates exactly like slice", () => {
  assertEquals(sliceSafe("abcdef", 3), "abc");
});

Deno.test("strings shorter than the limit pass through untouched", () => {
  assertEquals(sliceSafe("abc", 500), "abc");
  assertEquals(sliceSafe("", 500), "");
});

Deno.test("emoji fully inside the limit is kept", () => {
  // "ab😀" = 4 UTF-16 units; cutting at 4 keeps the whole pair.
  assertEquals(sliceSafe("ab😀cd", 4), "ab😀");
});

Deno.test("emoji straddling the boundary is dropped, not split", () => {
  // Cutting "ab😀" at 3 would strand the high surrogate — must yield "ab".
  const out = sliceSafe("ab😀cd", 3);
  assertEquals(out, "ab");
  assert(!ENDS_IN_HIGH_SURROGATE.test(out));
});

Deno.test("the replay-snapshot repro: emoji at exactly position 500", () => {
  const msg = "a".repeat(499) + "😀" + " and more text";
  const out = sliceSafe(msg, 500);
  assertEquals(out, "a".repeat(499));
  assert(!ENDS_IN_HIGH_SURROGATE.test(out));
  // Valid Unicode round-trips through JSON — what a jsonb insert needs.
  assertEquals(JSON.parse(JSON.stringify(out)), out);
});

Deno.test("astral CJK (U+20000) is protected like emoji", () => {
  const s = "xy" + String.fromCodePoint(0x20000) + "z";
  assertEquals(sliceSafe(s, 3), "xy");
  assertEquals(sliceSafe(s, 4), "xy" + String.fromCodePoint(0x20000));
});

Deno.test("zero-length limit behaves like slice", () => {
  assertEquals(sliceSafe("abc", 0), "");
});
