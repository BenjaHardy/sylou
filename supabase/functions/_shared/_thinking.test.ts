// Deno unit tests for the max_tokens ceilings: every OUTPUT_BUDGETS entry
// carries an explicit plain/reasoning pair, and resolveMaxTokens picks the
// reasoning ceiling only when reasoning is actually on for an eligible
// model. Pins the 2026-09 raise (see OUTPUT_BUDGETS in _models.ts) and
// guards against the old size-inferred tiering coming back.
// Run with: deno test supabase/functions/_shared/_thinking.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { OUTPUT_BUDGETS } from "./_models.ts";
import {
  CHAT_MISTRAL_EFFORT,
  CONTEXT_MISTRAL_EFFORT,
  EDITOR_MISTRAL_EFFORT,
  FLOW_MISTRAL_EFFORT,
  SUMMARY_MISTRAL_EFFORT,
  resolveMaxTokens,
  resolveMistralEffort,
} from "./_thinking.ts";

Deno.test("budget pairs are the agreed ceilings", () => {
  assertEquals(OUTPUT_BUDGETS.CHAT, { plain: 4_000, reasoning: 16_000 });
  assertEquals(OUTPUT_BUDGETS.CONTEXT_RESPONSE, { plain: 4_000, reasoning: 16_000 });
  assertEquals(OUTPUT_BUDGETS.CONTEXT_SUMMARY, { plain: 2_000, reasoning: 4_000 });
  assertEquals(OUTPUT_BUDGETS.EDITOR_ACTION, { plain: 4_000, reasoning: 6_000 });
  assertEquals(OUTPUT_BUDGETS.FLOW, { plain: 8_192, reasoning: 16_000 });
  assertEquals(OUTPUT_BUDGETS.DOC_SUMMARY, { plain: 500, reasoning: 2_000 });
  assertEquals(OUTPUT_BUDGETS.MEMORY, { plain: 3_000, reasoning: 6_000 });
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
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, "claude-opus-4-8", true), 16_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CONTEXT_RESPONSE, "zai-glm-5-3", false, true), 16_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CONTEXT_SUMMARY, "mistral-medium-3-5", false, true), 4_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.EDITOR_ACTION, "claude-opus-4-8", true), 6_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.FLOW, "claude-opus-4-8", true), 16_000);
});

Deno.test("reasoning flags on a non-reasoning model never raise the ceiling", () => {
  // mistral-large-2512 is not in MISTRAL_REASONING_MODELS; DeepSeek has no toggle.
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, "mistral-large-2512", false, true), 4_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, "deepseek-v4-flash", true, true), 4_000);
});

// GLM 5.3 (via the Mistral API) is reasoning-only: "low" | "high" | "max",
// no "none". An omitted field means the model's own default ("max"), which
// inside a plain budget leaves no room for the answer — so every table
// names an explicit level for it, and "low" stands in for "off".
const MISTRAL_EFFORT_TABLES = {
  FLOW_MISTRAL_EFFORT,
  CHAT_MISTRAL_EFFORT,
  EDITOR_MISTRAL_EFFORT,
  CONTEXT_MISTRAL_EFFORT,
  SUMMARY_MISTRAL_EFFORT,
};

Deno.test("GLM 5.3 is configured at an explicit level in every Mistral effort table, never none", () => {
  for (const [name, table] of Object.entries(MISTRAL_EFFORT_TABLES)) {
    const level = table["zai-glm-5-3"];
    assert(level !== undefined && level !== "none", `${name} must name a level for GLM 5.3`);
    assertEquals(resolveMistralEffort(table, "zai-glm-5-3"), level, name);
  }
  assertEquals(resolveMistralEffort(EDITOR_MISTRAL_EFFORT, "zai-glm-5-3"), "low");
  assertEquals(resolveMistralEffort(SUMMARY_MISTRAL_EFFORT, "zai-glm-5-3"), "low");
  assertEquals(resolveMistralEffort(FLOW_MISTRAL_EFFORT, "zai-glm-5-3"), "max");
  // "max" is GLM's deep-reasoning level: it spent whole chat budgets
  // thinking (2026-10), so chat and Ask/Propose default to "high".
  assertEquals(resolveMistralEffort(CHAT_MISTRAL_EFFORT, "zai-glm-5-3"), "high");
  assertEquals(resolveMistralEffort(CONTEXT_MISTRAL_EFFORT, "zai-glm-5-3"), "high");
});

Deno.test("Mistral's own reasoning models only ever get high or none (low and max are GLM-only)", () => {
  for (const [name, table] of Object.entries(MISTRAL_EFFORT_TABLES)) {
    for (const id of ["mistral-medium-3-5", "mistral-small-2603"]) {
      const level = table[id];
      assert(level === "high" || level === "none", `${name}[${id}] = ${level}`);
    }
  }
});

Deno.test("summary calls: GLM 5.3 reasons at low with the reasoning ceiling; every other model keeps the plain ceiling", () => {
  const glm = resolveMistralEffort(SUMMARY_MISTRAL_EFFORT, "zai-glm-5-3");
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.DOC_SUMMARY, "zai-glm-5-3", false, glm !== undefined), 2_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.MEMORY, "zai-glm-5-3", false, glm !== undefined), 6_000);
  for (const id of ["mistral-medium-3-5", "mistral-small-2603", "mistral-large-2512", "claude-sonnet-4-6", "claude-opus-4-8", "deepseek-v4-flash"]) {
    const effort = resolveMistralEffort(SUMMARY_MISTRAL_EFFORT, id);
    assertEquals(effort, undefined, id);
    assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.DOC_SUMMARY, id, false, effort !== undefined), 500, id);
    assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.MEMORY, id, false, effort !== undefined), 3_000, id);
  }
});
