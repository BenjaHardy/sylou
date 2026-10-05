// Deno unit tests for the temperature tables: the models that 400 on any
// sampling parameter never get one, whatever a table says.
// Run with: deno task test  (from supabase/functions/)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ALLOWED_MODELS } from "./_models.ts";
import {
  CHAT_TEMPERATURE,
  FLOW_TEMPERATURE,
  SUMMARY_TEMPERATURE,
  resolveTemperature,
} from "./_temperatures.ts";

const NO_TEMPERATURE = ["claude-opus-4-8", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1"];

Deno.test("Opus 4.7+, Sonnet 5.5 and Fable 5.1 never receive a temperature, even from a table entry", () => {
  for (const id of NO_TEMPERATURE) {
    assertEquals(resolveTemperature(FLOW_TEMPERATURE, id), undefined, id);
    assertEquals(resolveTemperature({ [id]: 0 }, id), undefined, id);
  }
  assertEquals(resolveTemperature({ "claude-opus-4-7": 0.5 }, "claude-opus-4-7"), undefined);
});

Deno.test("Sonnet 4.6 keeps its temperatures (FLOW at 0), clamped to Claude's [0, 1]", () => {
  assertEquals(resolveTemperature(FLOW_TEMPERATURE, "claude-sonnet-4-6"), 0);
  assertEquals(resolveTemperature(CHAT_TEMPERATURE, "claude-sonnet-4-6"), 1);
  assertEquals(resolveTemperature(SUMMARY_TEMPERATURE, "claude-sonnet-4-6"), 0.3);
  assertEquals(resolveTemperature({ "claude-sonnet-4-6": 1.5 }, "claude-sonnet-4-6"), 1);
});

Deno.test("every allowed Claude model is either temperature-free or in every table; unknown ids get nothing", () => {
  for (const id of [...ALLOWED_MODELS].filter((m) => m.startsWith("claude-"))) {
    const free = NO_TEMPERATURE.includes(id);
    assertEquals(resolveTemperature(FLOW_TEMPERATURE, id) === undefined, free, id);
  }
  assertEquals(resolveTemperature(FLOW_TEMPERATURE, "claude-haiku-4-5"), undefined);
});
