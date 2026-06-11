// Deno unit tests for sanitizeAnthropicSchema and toAnthropicBody.
// Run with: deno test supabase/functions/_shared/_llm.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sanitizeAnthropicSchema, toAnthropicBody } from "./_llm.ts";

Deno.test("no-op: allowlisted-only schema round-trips structurally identical", () => {
  const input = {
    type: "object",
    required: ["a"],
    description: "obj",
    properties: {
      a: { type: "string", description: "a string" },
      b: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
  const snapshot = JSON.parse(JSON.stringify(input));
  const out = sanitizeAnthropicSchema(input);
  assertEquals(out, input);
  // Caller's input must not be mutated.
  assertEquals(input, snapshot);
});

Deno.test("strips numeric/length/format constraints and merges into description", () => {
  const out = sanitizeAnthropicSchema({
    type: "string",
    description: "Email",
    format: "email",
    maxLength: 256,
    minLength: 3,
  }) as Record<string, unknown>;
  assertEquals(out.type, "string");
  assert(!("format" in out));
  assert(!("maxLength" in out));
  assert(!("minLength" in out));
  // Single parenthetical, all hints collected.
  assertEquals(out.description, "Email (format: email, max 256 chars, min 3 chars)");
});

Deno.test("strips maxItems and uniqueItems; surfaces in description", () => {
  const out = sanitizeAnthropicSchema({
    type: "array",
    items: { type: "string" },
    maxItems: 4,
    uniqueItems: true,
  }) as Record<string, unknown>;
  assert(!("maxItems" in out));
  assert(!("uniqueItems" in out));
  assertEquals(out.description, "(max 4 items, unique items)");
});

Deno.test("minItems: keeps 0 and 1, strips others", () => {
  const keep0 = sanitizeAnthropicSchema({ type: "array", items: { type: "string" }, minItems: 0 }) as Record<string, unknown>;
  const keep1 = sanitizeAnthropicSchema({ type: "array", items: { type: "string" }, minItems: 1 }) as Record<string, unknown>;
  const strip2 = sanitizeAnthropicSchema({ type: "array", items: { type: "string" }, minItems: 2 }) as Record<string, unknown>;
  assertEquals(keep0.minItems, 0);
  assertEquals(keep1.minItems, 1);
  assert(!("minItems" in strip2));
  assertEquals(strip2.description, "(min 2 items)");
});

Deno.test("recurses into properties and anyOf branches", () => {
  const out = sanitizeAnthropicSchema({
    type: "object",
    properties: {
      score: {
        anyOf: [
          { type: "number", minimum: 0, maximum: 5 },
          { type: "null" },
        ],
      },
    },
  }) as any;
  const numericBranch = out.properties.score.anyOf[0];
  const nullBranch = out.properties.score.anyOf[1];
  assert(!("minimum" in numericBranch));
  assert(!("maximum" in numericBranch));
  assertEquals(numericBranch.type, "number");
  assertEquals(numericBranch.description, "(≥ 0, ≤ 5)");
  assertEquals(nullBranch, { type: "null" });
});

Deno.test("boolean schemas pass through unchanged", () => {
  assertEquals(sanitizeAnthropicSchema(true as unknown), true);
  assertEquals(sanitizeAnthropicSchema(false as unknown), false);
});

Deno.test("deep clone: mutating output does not affect input", () => {
  const input = {
    type: "object",
    properties: { a: { type: "string", description: "a" } },
  };
  const out = sanitizeAnthropicSchema(input) as any;
  out.properties.a.description = "MUTATED";
  assertEquals((input.properties.a as any).description, "a");
});

Deno.test("unknown future keys are stripped", () => {
  const out = sanitizeAnthropicSchema({
    type: "string",
    description: "x",
    someFutureConstraint: { foo: 1 },
  }) as Record<string, unknown>;
  assert(!("someFutureConstraint" in out));
  assert(typeof out.description === "string" && (out.description as string).includes("someFutureConstraint"));
});

Deno.test("toAnthropicBody: json_schema.name is kept internally but NOT forwarded in format", () => {
  const body = toAnthropicBody({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 1024,
    json_schema: {
      name: "submit_flow_analysis",
      schema: { type: "object", properties: {} },
    },
  });
  const fmt = (body.output_config as any)?.format;
  assertEquals(fmt?.type, "json_schema");
  assert!("schema" in fmt);
  assert(!("name" in fmt), "name must NOT appear in output_config.format — Anthropic rejects it");
});
