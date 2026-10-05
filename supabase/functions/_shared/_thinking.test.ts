// Deno unit tests for the max_tokens ceilings: every OUTPUT_BUDGETS entry
// carries an explicit plain/reasoning pair, and resolveMaxTokens picks the
// reasoning ceiling only when reasoning is actually on for an eligible
// model. Pins the 2026-09 raise (see OUTPUT_BUDGETS in _models.ts) and
// guards against the old size-inferred tiering coming back.
// Run with: deno test supabase/functions/_shared/_thinking.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ALLOWED_MODELS, CLAUDE_ALWAYS_THINKING, OUTPUT_BUDGETS } from "./_models.ts";
import {
  CHAT_EFFORT,
  CHAT_MISTRAL_EFFORT,
  CHAT_REASONING_OPTIONS,
  CHAT_THINKING,
  CONTEXT_EFFORT,
  CONTEXT_MISTRAL_EFFORT,
  CONTEXT_THINKING,
  EDITOR_EFFORT,
  EDITOR_MISTRAL_EFFORT,
  EDITOR_THINKING,
  FLOW_EFFORT,
  FLOW_MISTRAL_EFFORT,
  FLOW_THINKING,
  MISTRAL_REASONING_MODELS,
  SUMMARY_EFFORT,
  SUMMARY_MISTRAL_EFFORT,
  SUMMARY_THINKING,
  defaultReasoningId,
  resolveEffort,
  resolveMaxTokens,
  resolveMistralEffort,
  resolveReasoning,
  resolveThinking,
} from "./_thinking.ts";

const CLAUDE_MODELS = [...ALLOWED_MODELS].filter((id) => id.startsWith("claude-"));
const THINKING_TABLES = { FLOW_THINKING, CHAT_THINKING, EDITOR_THINKING, CONTEXT_THINKING, SUMMARY_THINKING };
const EFFORT_TABLES = { FLOW_EFFORT, CHAT_EFFORT, EDITOR_EFFORT, CONTEXT_EFFORT, SUMMARY_EFFORT };

Deno.test("budget pairs are the agreed ceilings", () => {
  assertEquals(OUTPUT_BUDGETS.CHAT, { plain: 4_000, reasoning: 24_000 });
  assertEquals(OUTPUT_BUDGETS.CONTEXT_RESPONSE, { plain: 4_000, reasoning: 24_000 });
  assertEquals(OUTPUT_BUDGETS.CONTEXT_SUMMARY, { plain: 2_000, reasoning: 4_000 });
  assertEquals(OUTPUT_BUDGETS.EDITOR_ACTION, { plain: 4_000, reasoning: 6_000 });
  assertEquals(OUTPUT_BUDGETS.FLOW, { plain: 8_192, reasoning: 24_000 });
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
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, "claude-opus-4-8", true), 24_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CONTEXT_RESPONSE, "zai-glm-5-3", false, true), 24_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CONTEXT_SUMMARY, "mistral-medium-3-5", false, true), 4_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.EDITOR_ACTION, "claude-opus-4-8", true), 6_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.FLOW, "claude-opus-4-8", true), 24_000);
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
  // "max" is GLM's deep-reasoning level: it spent whole budgets thinking
  // (2026-10) — chat and Ask/Propose default to "high". FLOW is "high" too:
  // the model is not recommended for FLOW (every level failed the
  // maintainer's independence test), so the fast level serves whoever
  // selects it anyway.
  assertEquals(resolveMistralEffort(FLOW_MISTRAL_EFFORT, "zai-glm-5-3"), "high");
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

Deno.test("summary calls: GLM 5.3 and the thinking Claude models get the reasoning ceiling; every other model keeps the plain one", () => {
  const glm = resolveMistralEffort(SUMMARY_MISTRAL_EFFORT, "zai-glm-5-3");
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.DOC_SUMMARY, "zai-glm-5-3", false, glm !== undefined), 2_000);
  assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.MEMORY, "zai-glm-5-3", false, glm !== undefined), 6_000);
  for (const id of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]) {
    const thinking = resolveThinking(SUMMARY_THINKING, id);
    assertEquals(thinking, true, id);
    assertEquals(resolveEffort(SUMMARY_EFFORT, id), "low", id);
    assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.DOC_SUMMARY, id, thinking), 2_000, id);
    assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.MEMORY, id, thinking), 6_000, id);
  }
  for (const id of ["mistral-medium-3-5", "mistral-small-2603", "mistral-large-2512", "claude-sonnet-4-6", "claude-opus-4-8", "deepseek-v4-flash"]) {
    const effort = resolveMistralEffort(SUMMARY_MISTRAL_EFFORT, id);
    const thinking = resolveThinking(SUMMARY_THINKING, id);
    assertEquals(effort, undefined, id);
    assertEquals(thinking, false, id);
    assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.DOC_SUMMARY, id, thinking, effort !== undefined), 500, id);
    assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.MEMORY, id, thinking, effort !== undefined), 3_000, id);
  }
});

// ── Claude 5.5 family and Fable 5.1 (2026-10) ───────────────────────────

Deno.test("every Claude model has an explicit entry in every thinking and effort table", () => {
  for (const [name, table] of Object.entries(THINKING_TABLES)) {
    for (const id of CLAUDE_MODELS) assert(typeof table[id] === "boolean", `${name}[${id}]`);
  }
  for (const [name, table] of Object.entries(EFFORT_TABLES)) {
    for (const id of CLAUDE_MODELS) assert(table[id] !== undefined, `${name}[${id}]`);
  }
});

Deno.test("always-on models think whatever a table says, and the reasoning ceiling follows", () => {
  for (const id of CLAUDE_ALWAYS_THINKING) {
    for (const [name, table] of Object.entries(THINKING_TABLES)) {
      assertEquals(table[id], true, `${name}[${id}] must say true (the API cannot turn it off)`);
      assertEquals(resolveThinking(table, id), true, `${name}[${id}]`);
    }
    assertEquals(resolveThinking({}, id), true, `${id}: forced on even without an entry`);
    assertEquals(resolveThinking({ [id]: false }, id), true, `${id}: forced on even when a table says false`);
    assertEquals(resolveMaxTokens(OUTPUT_BUDGETS.CHAT, id, resolveThinking({}, id)), 24_000, id);
    assert(!CHAT_REASONING_OPTIONS[id].some((o) => o.thinking === false), `${id}: no "off" option`);
  }
  // The rule is specific: Sonnet 4.6 and Opus 4.8 still follow their tables.
  assertEquals(resolveThinking({}, "claude-sonnet-4-6"), false);
  assertEquals(resolveThinking({ "claude-opus-4-8": false }, "claude-opus-4-8"), false);
});

Deno.test("Sonnet 5.5: the off option is between_tools territory (effort high or below) and thinking off nowhere by default", () => {
  const off = CHAT_REASONING_OPTIONS["claude-sonnet-5-5"].find((o) => o.id === "off");
  assert(off && off.thinking === false);
  assert(["low", "medium", "high"].includes(off.effort ?? ""), "between_tools is rejected at xhigh and max");
  for (const [name, table] of Object.entries(THINKING_TABLES)) assertEquals(table["claude-sonnet-5-5"], true, name);
});

Deno.test("the decided knobs: FLOW at xhigh (Fable medium), chat and context at medium, editor and summaries at low", () => {
  for (const id of ["claude-sonnet-5-5", "claude-opus-5-5"]) assertEquals(resolveEffort(FLOW_EFFORT, id), "xhigh", id);
  assertEquals(resolveEffort(FLOW_EFFORT, "claude-fable-5-1"), "medium");
  for (const id of ["claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"]) {
    assertEquals(resolveEffort(CHAT_EFFORT, id), "medium", id);
    assertEquals(resolveEffort(CONTEXT_EFFORT, id), "medium", id);
    assertEquals(resolveEffort(EDITOR_EFFORT, id), "low", id);
    assertEquals(resolveEffort(SUMMARY_EFFORT, id), "low", id);
    assertEquals(defaultReasoningId(id, CHAT_TABLES), "medium", id);
  }
  // Opus 4.8's writing summary no longer thinks; its other calls are unchanged.
  assertEquals(resolveThinking(SUMMARY_THINKING, "claude-opus-4-8"), false);
  assertEquals(resolveThinking(CONTEXT_THINKING, "claude-opus-4-8"), true);
  assertEquals(resolveEffort(CONTEXT_EFFORT, "claude-opus-4-8"), "high");
});

Deno.test("five effort levels: Extra is xhigh and Max is the API's max on every model that offers them", () => {
  for (const id of ["claude-sonnet-5-5", "claude-opus-4-8", "claude-opus-5-5", "claude-fable-5-1"]) {
    const options = CHAT_REASONING_OPTIONS[id];
    assertEquals(options.find((o) => o.id === "xhigh")?.effort, "xhigh", id);
    assertEquals(options.find((o) => o.id === "max")?.effort, "max", id);
    assertEquals(resolveReasoning(id, { [id]: "max" }, CHAT_TABLES).effort, "max", id);
    assertEquals(resolveReasoning(id, { [id]: "xhigh" }, CHAT_TABLES).effort, "xhigh", id);
  }
  // Sonnet 4.6 keeps its four options and clamps a stray xhigh to high.
  assertEquals(CHAT_REASONING_OPTIONS["claude-sonnet-4-6"].map((o) => o.id), ["off", "low", "medium", "high"]);
  assertEquals(resolveEffort({ "claude-sonnet-4-6": "xhigh" }, "claude-sonnet-4-6"), "high");
  assertEquals(resolveEffort({ "claude-opus-5-5": "xhigh" }, "claude-opus-5-5"), "xhigh");
});

// ── User-selectable reasoning (CHAT_REASONING_OPTIONS / resolveReasoning) ──

const CHAT_TABLES = { thinking: CHAT_THINKING, effort: CHAT_EFFORT, mistral: CHAT_MISTRAL_EFFORT };
const CONTEXT_TABLES = { thinking: CONTEXT_THINKING, effort: CONTEXT_EFFORT, mistral: CONTEXT_MISTRAL_EFFORT };

Deno.test("reasoning options: registry models only, unique ids, every option permitted for its provider", () => {
  for (const [model, options] of Object.entries(CHAT_REASONING_OPTIONS)) {
    assert(ALLOWED_MODELS.has(model), `${model} is not an allowed model`);
    const ids = options.map((o) => o.id);
    assertEquals(new Set(ids).size, ids.length, `${model}: duplicate option ids`);
    for (const o of options) {
      if (model.startsWith("claude-")) {
        assertEquals(o.mistral_effort, undefined, `${model}/${o.id}: Claude options carry no mistral_effort`);
        assert(typeof o.thinking === "boolean" && o.effort !== undefined, `${model}/${o.id}: Claude options set thinking + effort`);
      } else {
        assert(MISTRAL_REASONING_MODELS.has(model), `${model}: only Mistral reasoning models have options`);
        assertEquals(o.thinking, undefined, `${model}/${o.id}: no Claude knobs on a Mistral model`);
        assert(o.mistral_effort !== undefined, `${model}/${o.id}: Mistral options set mistral_effort`);
      }
    }
  }
  // Sonnet 4.6 rejects xhigh; GLM 5.3 cannot run without reasoning; Mistral's
  // own reasoning models know only high / none.
  assert(!CHAT_REASONING_OPTIONS["claude-sonnet-4-6"].some((o) => o.effort === "xhigh"));
  assert(!CHAT_REASONING_OPTIONS["zai-glm-5-3"].some((o) => o.mistral_effort === "none"));
  for (const id of ["mistral-medium-3-5", "mistral-small-2603"]) {
    for (const o of CHAT_REASONING_OPTIONS[id]) {
      assert(o.mistral_effort === "high" || o.mistral_effort === "none", `${id}/${o.id}`);
    }
  }
});

Deno.test("reasoning options: the chat and context tables name a default that exists as an option", () => {
  for (const model of Object.keys(CHAT_REASONING_OPTIONS)) {
    assert(defaultReasoningId(model, CHAT_TABLES) !== null, `${model}: CHAT tables match no option`);
    assert(defaultReasoningId(model, CONTEXT_TABLES) !== null, `${model}: CONTEXT tables match no option`);
  }
  assertEquals(defaultReasoningId("zai-glm-5-3", CHAT_TABLES), "high");
  assertEquals(defaultReasoningId("claude-sonnet-4-6", CHAT_TABLES), "off");
  assertEquals(defaultReasoningId("claude-opus-4-8", CHAT_TABLES), "high");
  assertEquals(defaultReasoningId("mistral-medium-3-5", CHAT_TABLES), "high");
  assertEquals(defaultReasoningId("mistral-small-2603", CHAT_TABLES), "off");
  assertEquals(defaultReasoningId("mistral-large-2512", CHAT_TABLES), null);
  assertEquals(defaultReasoningId("deepseek-v4-flash", CHAT_TABLES), null);
});

Deno.test("resolveReasoning: a stored valid choice wins and is reported as the user's", () => {
  const stored = { "zai-glm-5-3": "max", "claude-opus-4-8": "low", "claude-sonnet-4-6": "off" };
  assertEquals(resolveReasoning("zai-glm-5-3", stored, CHAT_TABLES), {
    thinking: false, effort: undefined, mistralEffort: "max", optionId: "max", userChosen: true,
  });
  assertEquals(resolveReasoning("claude-opus-4-8", stored, CHAT_TABLES), {
    thinking: true, effort: "low", mistralEffort: undefined, optionId: "low", userChosen: true,
  });
  assertEquals(resolveReasoning("claude-sonnet-4-6", stored, CHAT_TABLES), {
    thinking: false, effort: "high", mistralEffort: undefined, optionId: "off", userChosen: true,
  });
  // "off" on a Mistral reasoning model omits the field (undefined, never "none").
  const off = resolveReasoning("mistral-medium-3-5", { "mistral-medium-3-5": "off" }, CHAT_TABLES);
  assertEquals(off.mistralEffort, undefined);
  assertEquals(off.optionId, "off");
  assertEquals(off.userChosen, true);
});

Deno.test("resolveReasoning: missing, unknown or malformed choices fall back to the tables", () => {
  const def = resolveReasoning("zai-glm-5-3", undefined, CHAT_TABLES);
  assertEquals(def, { thinking: false, effort: undefined, mistralEffort: "high", optionId: "high", userChosen: false });
  for (const stored of [null, "max", 42, ["max"], {}, { "zai-glm-5-3": "turbo" }, { "zai-glm-5-3": 1 }, { "claude-opus-4-8": "max" }]) {
    assertEquals(resolveReasoning("zai-glm-5-3", stored, CHAT_TABLES), def, JSON.stringify(stored));
  }
  // A model without options keeps its fixed settings and reports no option,
  // whatever is stored under its id.
  assertEquals(resolveReasoning("mistral-large-2512", { "mistral-large-2512": "high" }, CHAT_TABLES), {
    thinking: false, effort: undefined, mistralEffort: undefined, optionId: null, userChosen: false,
  });
  assertEquals(resolveReasoning("deepseek-v4-flash", {}, CHAT_TABLES).optionId, null);
  // Another model's choice never leaks across ids.
  assertEquals(resolveReasoning("claude-sonnet-4-6", { "claude-opus-4-8": "max" }, CHAT_TABLES).userChosen, false);
});
