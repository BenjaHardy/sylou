// analysis/prompts.test.ts — byte-level pins of the FLOW methodology
// surface (P4-1 Phase D split). The two templates are versioned
// methodology artifacts (v1.2_270826): the SHA-256 pins cover their
// exact runtime bytes, so ANY edit — even an en-dash swapped for a
// hyphen or a dropped escaped backtick — goes red here. A red test means
// the methodology changed; that needs a deliberate version bump and a
// checkpoint, not a test edit. (Template values are LF-normalized by the
// JS engine, so the hashes are stable across CRLF/LF checkouts. SHA-256
// via the built-in Web Crypto — std@0.224.0's crypto wasm module does
// not load under `deno test` on deno 2.9.)
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals, assertStrictEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import {
  CREATIVE_FLOW_PROMPT_TEMPLATE,
  FLOW_PROMPT_TEMPLATE,
  SUBMIT_FLOW_TOOL,
} from "./prompts.ts";

const sha256 = async (s: string) =>
  encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

Deno.test("FLOW template bytes are pinned (methodology v1.2_270826)", async () => {
  assertEquals(FLOW_PROMPT_TEMPLATE.length, 9004);
  assertEquals(
    await sha256(FLOW_PROMPT_TEMPLATE),
    "4dc89aa65e86df7b210924ea90691c865c3f65e1e4b741fd0d10fb059f319df3",
  );
});

Deno.test("creative FLOW template bytes are pinned (methodology v1.2_270826)", async () => {
  assertEquals(CREATIVE_FLOW_PROMPT_TEMPLATE.length, 9400);
  assertEquals(
    await sha256(CREATIVE_FLOW_PROMPT_TEMPLATE),
    "565a440e9147f50d87414a3b5aa74fe339d6f2dc057a1a664a9326de7e608eb5",
  );
});

Deno.test("templates are frozen strings — no interpolation syntax survives to runtime", () => {
  for (const t of [FLOW_PROMPT_TEMPLATE, CREATIVE_FLOW_PROMPT_TEMPLATE]) {
    assert(!t.includes("${"), "template must contain zero ${...} interpolations");
  }
});

Deno.test("assessment-integrity section present in both templates", () => {
  for (const t of [FLOW_PROMPT_TEMPLATE, CREATIVE_FLOW_PROMPT_TEMPLATE]) {
    assert(t.includes("# === ASSESSMENT INTEGRITY ==="));
    // The framing declares the platform-added labels trustworthy; the
    // matching emitter lives in sections.ts (cross-pinned there).
    assert(t.includes('"[NOT ASSESSED]" labels'));
    assert(t.includes("[t]/[cc]/[ce]/[ai]"));
  }
});

Deno.test("response format names the tool and the four pillar keys", () => {
  for (const t of [FLOW_PROMPT_TEMPLATE, CREATIVE_FLOW_PROMPT_TEMPLATE]) {
    assert(t.includes("submit_flow_analysis"));
    assert(t.includes("`find`, `lead`, `organize`, and `write`"));
  }
});

Deno.test("tool schema: name, required sections, pillar shape", () => {
  assertEquals(SUBMIT_FLOW_TOOL.name, "submit_flow_analysis");
  assertEquals(SUBMIT_FLOW_TOOL.input_schema.required, [
    "summary", "find", "lead", "organize", "write", "key_user_contributions",
  ]);
  const pillar = SUBMIT_FLOW_TOOL.input_schema.properties.find;
  assertEquals(pillar.required, ["reasoning", "evidence", "score", "narrative"]);
  assertEquals(pillar.properties.evidence.minItems, 2);
  assertEquals(pillar.properties.evidence.maxItems, 4);
});

Deno.test("all four pillars share ONE schema object (drift-proof by identity)", () => {
  const p = SUBMIT_FLOW_TOOL.input_schema.properties;
  assertStrictEquals(p.find, p.lead);
  assertStrictEquals(p.find, p.organize);
  assertStrictEquals(p.find, p.write);
});
