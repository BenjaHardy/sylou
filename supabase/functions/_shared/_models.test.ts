// Deno unit tests for the server-side model allowlist + input limits.
// Run with: deno test supabase/functions/_shared/_models.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_MODELS,
  CLAUDE_ALWAYS_THINKING,
  CLAUDE_THINKING_OFF_BETWEEN_TOOLS,
  CONTEXT_LIMIT_TOKENS,
  FALLBACK_CONTEXT_LIMIT_TOKENS,
  INPUT_LIMITS,
} from "./_models.ts";

Deno.test("allowlist contains exactly the ten registry models", () => {
  assertEquals([...ALLOWED_MODELS].sort(), [
    "claude-fable-5-1",
    "claude-opus-4-8",
    "claude-opus-5-5",
    "claude-sonnet-4-6",
    "claude-sonnet-5-5",
    "deepseek-v4-flash",
    "mistral-large-2512",
    "mistral-medium-3-5",
    "mistral-small-2603",
    "zai-glm-5-3",
  ]);
});

Deno.test("the Claude thinking-rule sets name allowed Claude models only and never overlap", () => {
  for (const set of [CLAUDE_ALWAYS_THINKING, CLAUDE_THINKING_OFF_BETWEEN_TOOLS]) {
    for (const id of set) {
      assert(ALLOWED_MODELS.has(id), `${id} is not an allowed model`);
      assert(id.startsWith("claude-"), `${id} is not a Claude model`);
    }
  }
  for (const id of CLAUDE_ALWAYS_THINKING) assert(!CLAUDE_THINKING_OFF_BETWEEN_TOOLS.has(id), id);
  assertEquals([...CLAUDE_ALWAYS_THINKING].sort(), ["claude-fable-5-1", "claude-opus-5-5"]);
  assertEquals([...CLAUDE_THINKING_OFF_BETWEEN_TOOLS], ["claude-sonnet-5-5"]);
});

Deno.test("legacy, foreign and arbitrary ids are rejected", () => {
  for (
    const id of [
      "gpt-4",
      "claude-opus-4-1", // valid Anthropic id, deliberately not on the menu
      "deepseek-chat", // upstream-discontinued legacy alias
      "mistral-large-3", // renamed legacy id
      "mistral-large-latest",
      "",
      "x",
    ]
  ) {
    assert(!ALLOWED_MODELS.has(id), `${id} must not be allowed`);
  }
});

Deno.test("input limits are sane and ordered", () => {
  assert(INPUT_LIMITS.SHORT_FIELD_CHARS < INPUT_LIMITS.INSTRUCTION_CHARS);
  assert(INPUT_LIMITS.INSTRUCTION_CHARS < INPUT_LIMITS.CHAT_MESSAGE_CHARS);
  assert(INPUT_LIMITS.CHAT_MESSAGE_CHARS < INPUT_LIMITS.SELECTED_TEXT_CHARS);
});

Deno.test("every allowed model has a context limit, and nothing else does", () => {
  assertEquals(
    Object.keys(CONTEXT_LIMIT_TOKENS).sort(),
    [...ALLOWED_MODELS].sort(),
  );
});

Deno.test("context limits are sane and the fallback is the floor", () => {
  for (const [id, limit] of Object.entries(CONTEXT_LIMIT_TOKENS)) {
    assert(
      limit >= FALLBACK_CONTEXT_LIMIT_TOKENS,
      `${id} context limit ${limit} is below the conservative fallback`,
    );
  }
  assert(FALLBACK_CONTEXT_LIMIT_TOKENS >= 100_000);
});
