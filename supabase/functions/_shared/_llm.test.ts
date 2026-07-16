// Deno unit tests for sanitizeAnthropicSchema, the body translators and
// fetchWithTimeout.
// Run with: deno test supabase/functions/_shared/_llm.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fetchWithTimeout, sanitizeAnthropicSchema, toAnthropicBody, toOpenAIBody } from "./_llm.ts";

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
  assert("schema" in fmt);
  assert(!("name" in fmt), "name must NOT appear in output_config.format — Anthropic rejects it");
});

// --- tool_choice threading (P2-3): forceTool must reach both provider bodies ---

const SAMPLE_TOOL = {
  type: "function" as const,
  function: {
    name: "submit_flow_report",
    description: "Submit the FLOW report",
    parameters: { type: "object", properties: {} },
  },
};

Deno.test("toOpenAIBody: forceTool emits the named-function tool_choice object", () => {
  const body = toOpenAIBody({
    model: "mistral-large-3",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 100,
    tools: [SAMPLE_TOOL],
    forceTool: "submit_flow_report",
  });
  assertEquals(body.tool_choice, {
    type: "function",
    function: { name: "submit_flow_report" },
  });
});

Deno.test("toOpenAIBody: tools without forceTool default to auto", () => {
  const body = toOpenAIBody({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 100,
    tools: [SAMPLE_TOOL],
  });
  assertEquals(body.tool_choice, "auto");
});

Deno.test("toOpenAIBody: explicit tool_choice is respected when not forcing", () => {
  const body = toOpenAIBody({
    model: "mistral-large-3",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 100,
    tools: [SAMPLE_TOOL],
    tool_choice: "none",
  });
  assertEquals(body.tool_choice, "none");
});

Deno.test("toOpenAIBody: no tools -> neither tools nor tool_choice in body", () => {
  const body = toOpenAIBody({
    model: "mistral-large-3",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 100,
    forceTool: "submit_flow_report",
  });
  assert(!("tools" in body));
  assert(!("tool_choice" in body));
});

Deno.test("toAnthropicBody: forceTool + disableParallelToolUse sets the flag", () => {
  const body = toAnthropicBody({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 100,
    tools: [SAMPLE_TOOL],
    forceTool: "submit_flow_report",
    disableParallelToolUse: true,
  });
  assertEquals(body.tool_choice, {
    type: "tool",
    name: "submit_flow_report",
    disable_parallel_tool_use: true,
  });
});

Deno.test("toAnthropicBody: forceTool alone omits disable_parallel_tool_use", () => {
  const body = toAnthropicBody({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 100,
    tools: [SAMPLE_TOOL],
    forceTool: "submit_flow_report",
  });
  assertEquals(body.tool_choice, { type: "tool", name: "submit_flow_report" });
});

Deno.test("toAnthropicBody: json_schema path sends no tools/tool_choice even with forceTool", () => {
  const body = toAnthropicBody({
    model: "claude-sonnet-4-6",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 100,
    tools: [SAMPLE_TOOL],
    forceTool: "submit_flow_report",
    json_schema: { name: "flow", schema: { type: "object", properties: {} } },
  });
  assert(!("tools" in body));
  assert(!("tool_choice" in body));
});

// --- fetchWithTimeout (P3-7e): outbound-request timeout wiring ---
// Tested with an injected fetch so no network (or --allow-net) is needed.

Deno.test("fetchWithTimeout: aborts a fetch that never settles", async () => {
  const hangingFetch = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The signal has been aborted", "AbortError")));
    });
  let message = "";
  try {
    await fetchWithTimeout("https://example.invalid/", {}, 50, hangingFetch);
  } catch (err) {
    message = (err as Error).message;
  }
  assert(message.includes("timed out after"), `unexpected: "${message}"`);
});

Deno.test("fetchWithTimeout: passes a settled response through and clears the timer", async () => {
  const fastFetch = (_url: string, _init?: RequestInit) =>
    Promise.resolve(new Response("ok"));
  const res = await fetchWithTimeout("https://example.invalid/", {}, 50, fastFetch);
  assertEquals(await res.text(), "ok");
  // Give the (cleared) timer a chance to misfire if it wasn't cleared —
  // Deno's test sanitizer would also flag a leaked timer.
  await new Promise((resolve) => setTimeout(resolve, 80));
});

Deno.test("fetchWithTimeout: non-abort errors pass through unchanged", async () => {
  const failingFetch = (_url: string, _init?: RequestInit) =>
    Promise.reject(new Error("ECONNREFUSED"));
  let message = "";
  try {
    await fetchWithTimeout("https://example.invalid/", {}, 1000, failingFetch);
  } catch (err) {
    message = (err as Error).message;
  }
  assertEquals(message, "ECONNREFUSED");
});
