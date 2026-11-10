// Deno unit tests for sizing a call to a local model: the cautious token
// estimate, the reply's room in the window, and fitLocalCall's answers.
// Run with: deno test supabase/functions/_shared/_fit.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { estimatePromptTokens, estimateTokens, fitLocalCall, fitReply } from "./_fit.ts";
import type { LLMMessage } from "./_llm.ts";

const ENV = { get: (_name: string) => undefined };
const windowOf = (contextTokens: number) => () => Promise.resolve({ contextTokens });

Deno.test("estimateTokens: one token per 3 bytes of UTF-8, rounded up", () => {
  assertEquals(estimateTokens(""), 0);
  assertEquals(estimateTokens("abc"), 1);
  assertEquals(estimateTokens("abcd"), 2);
  assertEquals(estimateTokens("é"), 1); // 2 bytes
  assertEquals(estimateTokens("漢字"), 2); // 6 bytes
});

Deno.test("estimatePromptTokens: each message's text plus 8 tokens of template", () => {
  const messages: LLMMessage[] = [{ role: "system", content: "abc" }, { role: "user", content: "abcdef" }];
  assertEquals(estimatePromptTokens(messages), (8 + 1) + (8 + 2));
});

Deno.test("fitReply: the budget when it fits, the room left (less 256) when tighter, null under the minimum", () => {
  assertEquals(fitReply(16_384, 2_000, 4_000, 500), 4_000);
  assertEquals(fitReply(8_192, 5_000, 4_000, 500), 2_936); // 8,192 − 256 margin − 5,000
  assertEquals(fitReply(8_192, 7_800, 4_000, 500), null);
});

Deno.test("fitLocalCall: the reply gets what the window the server reports leaves", async () => {
  const messages: LLMMessage[] = [{ role: "user", content: "x".repeat(1_500) }]; // 508 tokens
  const fit = await fitLocalCall({
    model: "ollama/sylou-nemo-16k",
    messages,
    budget: 4_000,
    minReply: 100,
    env: ENV,
    lookup: windowOf(1_000),
  });
  assertEquals(fit, { maxTokens: 236 }); // 1,000 − 256 margin − 508
});

Deno.test("fitLocalCall: a request too long for the window is a 400 naming the model and its window", async () => {
  const fit = await fitLocalCall({
    model: "ollama/sylou-nemo-16k",
    messages: [{ role: "user", content: "x".repeat(2_700) }], // 908 tokens
    budget: 4_000,
    minReply: 100,
    env: ENV,
    lookup: windowOf(1_000),
  });
  assert("error" in fit, JSON.stringify(fit));
  assertEquals(fit.status, 400);
  assert(fit.error.startsWith("Too long for sylou-nemo-16k:"), fit.error);
  assert(fit.error.includes("window of 1,000 tokens"), fit.error);
});

Deno.test("fitLocalCall: the lookup's error is a 503 carrying its message", async () => {
  const fit = await fitLocalCall({
    model: "ollama/sylou-nemo-16k",
    messages: [{ role: "user", content: "Hi" }],
    budget: 4_000,
    minReply: 100,
    env: ENV,
    lookup: () => Promise.resolve({ error: "Ollama is down." }),
  });
  assertEquals(fit, { error: "Ollama is down.", status: 503 });
});
