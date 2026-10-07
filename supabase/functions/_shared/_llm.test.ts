// Deno unit tests for sanitizeAnthropicSchema, the body translators and
// fetchWithTimeout.
// Run with: deno test supabase/functions/_shared/_llm.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractDeltaText,
  extractStopDetails,
  extractStopReason,
  fallbackReplyText,
  isProviderTimeout,
  isRefusalStop,
  isThinkingDelta,
  isTruncatedStop,
  fetchWithTimeout,
  normaliseResponse,
  ProviderTimeoutError,
  sanitizeAnthropicSchema,
  toAnthropicBody,
  toOpenAIBody,
} from "./_llm.ts";

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

Deno.test("toOpenAIBody: reasoning_effort is emitted at any explicit level and omitted for none/undefined", () => {
  // GLM 5.3 (via Mistral) adds "low" to the vocabulary; the builder passes
  // every explicit level through unchanged and keeps "none" off the wire.
  for (const level of ["low", "high", "max"] as const) {
    const body = toOpenAIBody({ model: "zai-glm-5-3", messages: [], max_tokens: 10, reasoning_effort: level });
    assertEquals(body.reasoning_effort, level);
  }
  assert(!("reasoning_effort" in toOpenAIBody({ model: "mistral-medium-3-5", messages: [], max_tokens: 10, reasoning_effort: "none" })));
  assert(!("reasoning_effort" in toOpenAIBody({ model: "mistral-large-2512", messages: [], max_tokens: 10 })));
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

// --- Mistral reasoning-mode content arrays ---
// With reasoning_effort ≠ "none" (Medium 3.5 in chat/context-prompt),
// non-streaming message.content is an ARRAY of ThinkChunk + TextChunk.
// The string-only read dropped the whole answer → "No response generated."

Deno.test("normaliseResponse (OpenAI shape): reasoning array content yields the text chunks", () => {
  const norm = normaliseResponse("mistral", {
    choices: [{
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: [{ type: "text", text: "reasoning trace…" }] },
          { type: "text", text: "Hello! How can I help?" },
        ],
      },
    }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  });
  assertEquals(norm.text, "Hello! How can I help?");
  assertEquals(norm.toolCalls, []);
  assertEquals(norm.usage, { input_tokens: 12, output_tokens: 34 });
});

Deno.test("normaliseResponse (OpenAI shape): plain string content is unchanged", () => {
  const norm = normaliseResponse("mistral", {
    choices: [{ message: { role: "assistant", content: "plain answer" } }],
  });
  assertEquals(norm.text, "plain answer");
});

Deno.test("normaliseResponse (OpenAI shape): tool_calls alongside a reasoning array still parse", () => {
  const norm = normaliseResponse("mistral", {
    choices: [{
      message: {
        role: "assistant",
        content: [{ type: "thinking", thinking: [{ type: "text", text: "…" }] }],
        tool_calls: [{ id: "abc", function: { name: "web_search", arguments: '{"query":"x"}' } }],
      },
    }],
  });
  assertEquals(norm.text, "");
  assertEquals(norm.toolCalls, [{ id: "abc", name: "web_search", arguments: { query: "x" } }]);
});

Deno.test("normaliseResponse (OpenAI shape): assistantMessage echoes ONLY the contract fields", () => {
  // GLM 5.2 (via the Mistral API) decorates its response message with
  // `index` and 422-rejects it (`extra_forbidden`) when the assistant turn
  // is echoed back in a tool loop. The echo must be a whitelisted rebuild,
  // never the provider's raw object.
  const norm = normaliseResponse("mistral", {
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "calling a tool",
        index: 0,
        reasoning_content: "provider-side decoration",
        tool_calls: [{
          id: "abc",
          index: 0,
          function: { name: "web_search", arguments: '{"query":"x"}' },
        }],
      },
    }],
  });
  assertEquals(norm.assistantMessage, {
    role: "assistant",
    content: "calling a tool",
    tool_calls: [{
      id: "abc",
      type: "function",
      function: { name: "web_search", arguments: '{"query":"x"}' },
    }],
  });
});

Deno.test("normaliseResponse (OpenAI shape): reasoning-array content round-trips unchanged in the echo", () => {
  const chunks = [{ type: "thinking", thinking: [{ type: "text", text: "…" }] }];
  const norm = normaliseResponse("mistral", {
    choices: [{ message: { role: "assistant", content: chunks } }],
  });
  assertEquals(norm.assistantMessage, { role: "assistant", content: chunks });
});

Deno.test("normaliseResponse (OpenAI shape): null content echoes as empty string, no tool_calls key when none", () => {
  const norm = normaliseResponse("mistral", {
    choices: [{ message: { role: "assistant", content: null } }],
  });
  assertEquals(norm.assistantMessage, { role: "assistant", content: "" });
  assertEquals("tool_calls" in norm.assistantMessage, false);
});

Deno.test("extractDeltaText: array-of-chunks delta joins only the text chunks", () => {
  const delta = extractDeltaText({
    choices: [{
      delta: {
        content: [
          { type: "thinking", thinking: [] },
          { type: "text", text: "Hel" },
          { type: "text", text: "lo" },
        ],
      },
    }],
  }, "mistral");
  assertEquals(delta, "Hello");
});

// --- fetchWithTimeout (P3-7e): outbound-request timeout wiring ---
// Tested with an injected fetch so no network (or --allow-net) is needed.

Deno.test("fetchWithTimeout: aborts a fetch that never settles", async () => {
  const hangingFetch = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("The signal has been aborted", "AbortError")));
    });
  let caught: unknown = null;
  try {
    await fetchWithTimeout("https://example.invalid/", {}, 50, hangingFetch);
  } catch (err) {
    caught = err;
  }
  assert(caught instanceof ProviderTimeoutError, `unexpected: ${String(caught)}`);
  assert((caught as Error).message.includes("timed out after"));
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

// ── stop reasons (2026-09, large-selection safety) ────────────────────

Deno.test("isThinkingDelta: reasoning chunks of every provider are recognised, answer text is not", () => {
  // Mistral reasoning models / GLM via Mistral: content array with a thinking block.
  assert(isThinkingDelta({ choices: [{ delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "hmm" }] }] } }] }));
  assertEquals(isThinkingDelta({ choices: [{ delta: { content: [{ type: "text", text: "answer" }] } }] }), false);
  assertEquals(isThinkingDelta({ choices: [{ delta: { content: "answer" } }] }), false);
  // DeepSeek-style reasoning_content.
  assert(isThinkingDelta({ choices: [{ delta: { reasoning_content: "hmm" } }] }));
  assertEquals(isThinkingDelta({ choices: [{ delta: { reasoning_content: "", content: "x" } }] }), false);
  // Anthropic: thinking block start and thinking_delta; text_delta and text blocks are not.
  assert(isThinkingDelta({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
  assert(isThinkingDelta({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } }));
  assertEquals(isThinkingDelta({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } }), false);
  assertEquals(isThinkingDelta({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), false);
  for (const junk of [null, undefined, "x", 42, {}, { choices: [] }, { choices: [{}] }]) {
    assertEquals(isThinkingDelta(junk), false, String(junk));
  }
});

Deno.test("extractStopReason: OpenAI finish_reason and Anthropic message_delta stop_reason; null otherwise", () => {
  assertEquals(extractStopReason({ choices: [{ delta: { content: "x" }, finish_reason: "length" }] }), "length");
  assertEquals(extractStopReason({ choices: [{ delta: { content: "x" } }] }), null);
  assertEquals(extractStopReason({ type: "message_delta", delta: { stop_reason: "max_tokens" } }), "max_tokens");
  assertEquals(extractStopReason({ type: "content_block_delta", delta: { text: "x" } }), null);
  assertEquals(extractStopReason(null), null);
  assertEquals(isTruncatedStop("length"), true);
  assertEquals(isTruncatedStop("max_tokens"), true);
  assertEquals(isTruncatedStop("stop"), false);
});

Deno.test("normaliseResponse: exposes the provider stop reason for both wire shapes", () => {
  const anthropic = normaliseResponse("anthropic", { content: [{ type: "text", text: "hi" }], stop_reason: "max_tokens" });
  assertEquals(anthropic.stopReason, "max_tokens");
  const openai = normaliseResponse("mistral", { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] });
  assertEquals(openai.stopReason, "stop");
  const none = normaliseResponse("mistral", { choices: [{ message: { content: "hi" } }] });
  assertEquals(none.stopReason, null);
});

// ── Anthropic assistant turns echoed as received (2026-10) ──────────────
// Inside a tool-use turn the API wants the thinking blocks back complete and
// unmodified; the 5.5 family binds them to the prefix that produced them.

const ANTHROPIC_TURN = [
  { type: "thinking", thinking: "", signature: "sig-1" },
  { type: "redacted_thinking", data: "opaque" },
  { type: "text", text: "Let me check." },
  { type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "x" } },
];

const ECHOED_TOOL_CALL = {
  id: "toolu_1",
  type: "function" as const,
  function: { name: "web_search", arguments: "{\"query\":\"x\"}" },
};

Deno.test("normaliseResponse (Anthropic): keeps the content blocks as received on the assistant message", () => {
  const norm = normaliseResponse("anthropic", { content: ANTHROPIC_TURN, stop_reason: "tool_use" });
  assertEquals(norm.text, "Let me check.");
  assertEquals(norm.toolCalls, [{ id: "toolu_1", name: "web_search", arguments: { query: "x" } }]);
  assertEquals(norm.assistantMessage.raw_content, ANTHROPIC_TURN);
  assertEquals(norm.assistantMessage.content, "Let me check.");
  assertEquals(norm.assistantMessage.tool_calls, [ECHOED_TOOL_CALL]);
  // A reply with no blocks (a refusal before any output) carries no raw_content.
  const empty = normaliseResponse("anthropic", { content: [], stop_reason: "refusal" });
  assertEquals("raw_content" in empty.assistantMessage, false);
  // The OpenAI shape never sets it.
  const openai = normaliseResponse("mistral", { choices: [{ message: { content: "hi" } }] });
  assertEquals("raw_content" in openai.assistantMessage, false);
});

Deno.test("toAnthropicBody: an assistant turn with raw_content is echoed verbatim, thinking blocks included", () => {
  const body = toAnthropicBody({
    model: "claude-sonnet-5-5",
    max_tokens: 100,
    messages: [
      { role: "user", content: "search x" },
      { role: "assistant", content: "Let me check.", tool_calls: [ECHOED_TOOL_CALL], raw_content: ANTHROPIC_TURN },
      { role: "tool", tool_call_id: "toolu_1", content: "results" },
    ],
  });
  const msgs = body.messages as Array<Record<string, unknown>>;
  assertEquals(msgs[1], { role: "assistant", content: ANTHROPIC_TURN });
  assertEquals(msgs[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "results" }] });
});

Deno.test("toAnthropicBody: without raw_content the assistant turn is rebuilt from text and tool calls", () => {
  const body = toAnthropicBody({
    model: "claude-opus-4-8",
    max_tokens: 100,
    messages: [
      { role: "user", content: "search x" },
      { role: "assistant", content: "Let me check.", tool_calls: [ECHOED_TOOL_CALL] },
    ],
  });
  const msgs = body.messages as Array<Record<string, unknown>>;
  assertEquals(msgs[1], {
    role: "assistant",
    content: [
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "toolu_1", name: "web_search", input: { query: "x" } },
    ],
  });
});

Deno.test("toAnthropicBody: tool_choice none keeps the tool list on the wire as {type: none}; auto sends no tool_choice", () => {
  const none = toAnthropicBody({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }], max_tokens: 100, tools: [SAMPLE_TOOL], tool_choice: "none" });
  assertEquals((none.tools as unknown[]).length, 1);
  assertEquals(none.tool_choice, { type: "none" });
  const auto = toAnthropicBody({ model: "claude-sonnet-5-5", messages: [{ role: "user", content: "hi" }], max_tokens: 100, tools: [SAMPLE_TOOL], tool_choice: "auto" });
  assert(!("tool_choice" in auto));
  // Nothing to decline without tools.
  assert(!("tool_choice" in toAnthropicBody({ model: "claude-sonnet-5-5", messages: [], max_tokens: 100, tool_choice: "none" })));
});

Deno.test("toAnthropicBody: thinking on is adaptive; off is between_tools on Sonnet 5.5 and omitted elsewhere", () => {
  const on = toAnthropicBody({ model: "claude-opus-4-8", messages: [], max_tokens: 10, thinking: true, effort: "max" });
  assertEquals(on.thinking, { type: "adaptive" });
  assertEquals(on.output_config, { effort: "max" });
  assertEquals(toAnthropicBody({ model: "claude-sonnet-5-5", messages: [], max_tokens: 10, thinking: false, effort: "high" }).thinking, { type: "between_tools" });
  assertEquals(toAnthropicBody({ model: "claude-sonnet-5-5", messages: [], max_tokens: 10, thinking: true }).thinking, { type: "adaptive" });
  for (const model of ["claude-sonnet-4-6", "claude-opus-4-8", "claude-opus-5-5", "claude-fable-5-1"]) {
    assert(!("thinking" in toAnthropicBody({ model, messages: [], max_tokens: 10, thinking: false })), model);
  }
  // between_tools is accepted at effort high or below: higher levels clamp.
  const clamped = toAnthropicBody({ model: "claude-sonnet-5-5", messages: [], max_tokens: 10, thinking: false, effort: "xhigh" });
  assertEquals(clamped.thinking, { type: "between_tools" });
  assertEquals(clamped.output_config, { effort: "high" });
  const adaptiveMax = toAnthropicBody({ model: "claude-sonnet-5-5", messages: [], max_tokens: 10, thinking: true, effort: "max" });
  assertEquals(adaptiveMax.output_config, { effort: "max" });
});

Deno.test("fallbackReplyText: explicit messages on a refusal and on a ceiling spent thinking, the placeholder otherwise", () => {
  assert(fallbackReplyText("refusal").includes("declined"));
  assert(fallbackReplyText("max_tokens").includes("output limit"));
  assert(fallbackReplyText("length").includes("output limit"));
  assertEquals(fallbackReplyText("end_turn"), "No response generated.");
  assertEquals(fallbackReplyText(null), "No response generated.");
  assertEquals(fallbackReplyText(undefined), "No response generated.");
  assertEquals(isRefusalStop("refusal"), true);
  assertEquals(isRefusalStop("max_tokens"), false);
  assertEquals(isProviderTimeout(new ProviderTimeoutError(120_000, null)), true);
  assertEquals(isProviderTimeout(new Error("boom")), false);
  // The class is the signal, never the wording.
  assertEquals(isProviderTimeout(new Error("Provider request timed out after 120s")), false);
});

Deno.test("stop_details: carried from a non-streamed Anthropic refusal and from a streaming message_delta, null elsewhere", () => {
  const details = { type: "refusal", category: "reasoning_extraction", explanation: "x" };
  const refused = normaliseResponse("anthropic", { content: [], stop_reason: "refusal", stop_details: details });
  assertEquals(refused.stopDetails, details);
  assertEquals(normaliseResponse("anthropic", { content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" }).stopDetails, null);
  assertEquals(normaliseResponse("mistral", { choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }).stopDetails, null);
  assertEquals(extractStopDetails({ type: "message_delta", delta: { stop_reason: "refusal", stop_details: details } }), details);
  assertEquals(extractStopDetails({ type: "message_delta", delta: { stop_reason: "end_turn" } }), null);
  assertEquals(extractStopDetails({ type: "content_block_delta", delta: { text: "x" } }), null);
  assertEquals(extractStopDetails(null), null);
});

Deno.test("toOpenAIBody: raw_content never reaches the OpenAI-shape wire", () => {
  const body = toOpenAIBody({
    model: "zai-glm-5-3",
    max_tokens: 100,
    messages: [
      { role: "assistant", content: "x", raw_content: [{ type: "text", text: "x" }] },
      { role: "user", content: "y" },
    ],
  });
  assertEquals(body.messages, [{ role: "assistant", content: "x" }, { role: "user", content: "y" }]);
});
