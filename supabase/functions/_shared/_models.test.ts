// Deno unit tests for the server-side model allowlist, the choice of a
// call's model and the input limits.
// Run with: deno test supabase/functions/_shared/_models.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ALLOWED_MODELS,
  CLAUDE_ALWAYS_THINKING,
  CLAUDE_THINKING_OFF_BETWEEN_TOOLS,
  CONTEXT_LIMIT_TOKENS,
  DEFAULT_CHAT_MODEL,
  DEFAULT_FLOW_MODEL,
  FALLBACK_CONTEXT_LIMIT_TOKENS,
  INPUT_LIMITS,
  resolveModel,
  resolveSavedModel,
} from "./_models.ts";

/** Runs `fn` with console.warn recorded instead of printed. */
function recordingWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

const LISTED = "mistral-small-2603";
const UNLISTED = "claude-opus-4-1"; // a real Anthropic id, deliberately not on the menu

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

Deno.test("both fallback defaults are allowed models", () => {
  assert(ALLOWED_MODELS.has(DEFAULT_CHAT_MODEL), DEFAULT_CHAT_MODEL);
  assert(ALLOWED_MODELS.has(DEFAULT_FLOW_MODEL), DEFAULT_FLOW_MODEL);
});

Deno.test("resolveModel: a listed requested model wins over the saved one", () => {
  assertEquals(resolveModel("claude-sonnet-4-6", LISTED, DEFAULT_CHAT_MODEL), {
    model: "claude-sonnet-4-6",
    source: "request",
  });
});

Deno.test("resolveModel: an unlisted requested model is an error naming it, cut to 64 characters", () => {
  assertEquals(resolveModel("gpt-9", LISTED, DEFAULT_CHAT_MODEL), { error: "Unsupported model: gpt-9" });
  assertEquals(resolveModel(UNLISTED, LISTED, DEFAULT_CHAT_MODEL), { error: `Unsupported model: ${UNLISTED}` });
  assertEquals(resolveModel("x".repeat(100), null, DEFAULT_CHAT_MODEL), { error: `Unsupported model: ${"x".repeat(64)}` });
  assertEquals(resolveModel(42, LISTED, DEFAULT_CHAT_MODEL), { error: "Unsupported model: 42" });
});

Deno.test("resolveModel: an absent or empty requested model falls through to the saved one", () => {
  for (const requested of [undefined, null, ""]) {
    assertEquals(resolveModel(requested, LISTED, DEFAULT_CHAT_MODEL), { model: LISTED, source: "profile" });
  }
  // Saving the default itself still counts as the user's choice.
  assertEquals(resolveModel(undefined, DEFAULT_FLOW_MODEL, DEFAULT_FLOW_MODEL), {
    model: DEFAULT_FLOW_MODEL,
    source: "profile",
  });
});

Deno.test("resolveModel: an unlisted saved model gets the default, with one warning naming it", () => {
  const { result, warnings } = recordingWarnings(() => resolveModel(undefined, UNLISTED, DEFAULT_CHAT_MODEL));
  assertEquals(result, { model: DEFAULT_CHAT_MODEL, source: "default" });
  assertEquals(warnings, [`[model] saved model "${UNLISTED}" is not allowed; using ${DEFAULT_CHAT_MODEL}`]);
});

Deno.test("resolveSavedModel: every listed model is kept, silently", () => {
  const { warnings } = recordingWarnings(() => {
    for (const id of ALLOWED_MODELS) assertEquals(resolveSavedModel(id, DEFAULT_CHAT_MODEL), id);
  });
  assertEquals(warnings, []);
});

Deno.test("resolveSavedModel: retired, unknown and non-text values get the fallback, one warning each", () => {
  const saved = ["mistral-large-latest", "claude-opus-4-7", "zai-glm-5-2", "gpt-9", 7];
  const { result, warnings } = recordingWarnings(() => saved.map((s) => resolveSavedModel(s, DEFAULT_FLOW_MODEL)));
  assertEquals(result, saved.map(() => DEFAULT_FLOW_MODEL));
  assertEquals(warnings.length, saved.length);
});

Deno.test("resolveSavedModel: nothing saved gets the fallback without a warning", () => {
  const { result, warnings } = recordingWarnings(() => [null, undefined, ""].map((s) => resolveSavedModel(s, DEFAULT_CHAT_MODEL)));
  assertEquals(result, [DEFAULT_CHAT_MODEL, DEFAULT_CHAT_MODEL, DEFAULT_CHAT_MODEL]);
  assertEquals(warnings, []);
});

Deno.test("resolveSavedModel: the warning escapes the saved value and cuts it to 64 characters", () => {
  const saved = "line one\nline two " + "y".repeat(100);
  const { warnings } = recordingWarnings(() => resolveSavedModel(saved, DEFAULT_CHAT_MODEL));
  assertEquals(warnings, [
    `[model] saved model ${JSON.stringify(saved.slice(0, 64))} is not allowed; using ${DEFAULT_CHAT_MODEL}`,
  ]);
  assert(!warnings[0].includes("\n"), "the warning must stay on one log line");
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
