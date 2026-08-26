// Deno unit tests for the server-side model allowlist + input limits.
// Run with: deno test supabase/functions/_shared/_models.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_MODELS,
  CONTEXT_LIMIT_TOKENS,
  FALLBACK_CONTEXT_LIMIT_TOKENS,
  INPUT_LIMITS,
} from "./_models.ts";

Deno.test("allowlist contains exactly the seven registry models", () => {
  assertEquals([...ALLOWED_MODELS].sort(), [
    "claude-opus-4-8",
    "claude-sonnet-4-6",
    "deepseek-v4-flash",
    "mistral-large-2512",
    "mistral-medium-3-5",
    "mistral-small-2603",
    "zai-glm-5-2",
  ]);
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
