// _shared/_prompts.test.ts — byte-level pins of the shared mode/template
// prompts (P4-1 chat split). SHA-256 values were computed from the
// PRE-move sources (context-prompt/prompts.ts, md5-verified identical to
// chat's former duplicates), so these pins prove the unification changed
// nothing and guard every future byte — even a dash swap — from silent
// drift. TUTOR_MODE_SYSTEM_PROMPT's text is CC BY-SA 4.0 FLOW
// methodology (see LICENSING.md): a red pin means the methodology
// changed, which needs a deliberate decision, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { encodeHex } from "https://deno.land/std@0.224.0/encoding/hex.ts";
import {
  CLASSIC_MODE_SYSTEM_PROMPT,
  CONCISE_MODE_MODIFIER,
  TEMPLATE_PROMPTS,
  TUTOR_MODE_SYSTEM_PROMPT,
  WEB_SEARCH_PROMPT,
} from "./_prompts.ts";

const sha256 = async (s: string) =>
  encodeHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

Deno.test("classic prompt bytes are pinned", async () => {
  assertEquals(CLASSIC_MODE_SYSTEM_PROMPT.length, 1923);
  assertEquals(
    await sha256(CLASSIC_MODE_SYSTEM_PROMPT),
    "e34965223e0258181e3b5ba25da20a9283e321dd269a3300028899807a8cae9e",
  );
});

Deno.test("tutor prompt bytes are pinned (CC BY-SA methodology)", async () => {
  assertEquals(TUTOR_MODE_SYSTEM_PROMPT.length, 2746);
  assertEquals(
    await sha256(TUTOR_MODE_SYSTEM_PROMPT),
    "08919dd0c8af448109341eb80d807f9b301a067118f97f1a0e269143a93205a1",
  );
});

Deno.test("concise modifier bytes are pinned", async () => {
  assertEquals(CONCISE_MODE_MODIFIER.length, 441);
  assertEquals(
    await sha256(CONCISE_MODE_MODIFIER),
    "0b7e03b523efc679a2dfc2e6744c24672989df3d270784a317d6dc783708145f",
  );
});

Deno.test("template prompts: exact keys and pinned content", async () => {
  assertEquals(Object.keys(TEMPLATE_PROMPTS), ["academic", "creative", "professional"]);
  assertEquals(
    await sha256(JSON.stringify(TEMPLATE_PROMPTS)),
    "49baf45c31fb207ccc2119f55c6d09ab30a9aaf005f6e2a23a059bc5579f1c76",
  );
});

Deno.test("web-search block: leading separator, rules, the loop limits, and the deliberate ASCII hyphen", () => {
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
  assertEquals(WEB_SEARCH_PROMPT.length, 1294);
});

Deno.test("prompts are frozen strings — no interpolation syntax survives to runtime", () => {
  for (const t of [CLASSIC_MODE_SYSTEM_PROMPT, TUTOR_MODE_SYSTEM_PROMPT, CONCISE_MODE_MODIFIER, WEB_SEARCH_PROMPT]) {
    assert(!t.includes("${"));
  }
});
