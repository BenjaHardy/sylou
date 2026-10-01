// Deno unit tests for the max_tokens ceilings: every OUTPUT_BUDGETS entry
// carries an explicit plain/reasoning pair, and resolveMaxTokens picks the
// reasoning ceiling only when reasoning is actually on for an eligible
// model. Pins the 2026-09 raise (see OUTPUT_BUDGETS in _models.ts) and
// guards against the old size-inferred tiering coming back.
// Run with: deno test supabase/functions/_shared/_thinking.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { OUTPUT_BUDGETS } from "./_models.ts";
import { resolveMaxTokens } from "./_thinking.ts";

Deno.test("budget pairs are the agreed ceilings", () => {
  assertEquals(OUTPUT_BUDGETS.CHAT, { plain: 4_000, reasoning: 8_000 });
  assertEquals(OUTPUT_BUDGETS.CONTEXT_RESPONSE, { plain: 4_000, reasoning: 8_000 });
  assertEquals(OUTPUT_BUDGETS.CONTEXT_SUMMARY, { plain: 2_000, reasoning: 4_000 });
  assertEquals(OUTPUT_BUDGETS.EDITOR_ACTION, { plain: 4_000, reasoning: 6_000 });
  assertEquals(OUTPUT_BUDGETS.FLOW, { plain: 8_192, reasoning: 16_000 });
  for (const budget of Object.values(OUTPUT_BUDGETS)) {
    assert(budget.reasoning >= budget.plain, "reasoning ceiling must not be below plain");
  }
});

Deno.test("plain ceiling when reasoning is off", () => {
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, "claude-sonnet-4-6", false), 4_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.EDITOR_ACTION, "zai-glm-5-3", false, false), 4_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.FLOW, "claude-sonnet-4-6", false), 8_192);
});

Deno.test("reasoning ceiling for Claude thinking and Mistral reasoning models", () => {
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, "claude-opus-4-8", true), 8_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CONTEXT_RESPONSE, "zai-glm-5-3", false, true), 8_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CONTEXT_SUMMARY, "mistral-medium-3-5", false, true), 4_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.EDITOR_ACTION, "claude-opus-4-8", true), 6_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.FLOW, "claude-opus-4-8", true), 16_000);
});

Deno.test("reasoning flags on a non-reasoning model never raise the ceiling", () => {
  // mistral-large-2512 is not in MISTRAL_REASONING_MODELS; DeepSeek has no toggle.
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, "mistral-large-2512", false, true), 4_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, "deepseek-v4-flash", true, true), 4_000);
});
