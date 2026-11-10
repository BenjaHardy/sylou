// Deno unit tests for sizing a call to a local model: the cautious token
// estimate, the reply's room in the window, and fitLocalCall's answers.
// Run with: deno test supabase/functions/_shared/_fit.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  cutToFit,
  estimatePromptTokens,
  estimateTokens,
  fitLocalCall,
  fitReply,
  fitWindow,
  roomLeft,
} from "./_fit.ts";
import type { LLMMessage } from "./_llm.ts";
import { buildDocumentTool } from "./_tools.ts";

const ENV = { get: (_name: string) => undefined };
const windowOf = (contextTokens: number) => () => Promise.resolve({ contextTokens, tools: false });

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

Deno.test("estimatePromptTokens: the tools offered and the assistant's tool calls count too", () => {
  const toolCalls = [{ id: "c1", type: "function" as const, function: { name: "read_imported_document", arguments: "{}" } }];
  const messages: LLMMessage[] = [{ role: "assistant", content: "", tool_calls: toolCalls }];
  assertEquals(estimatePromptTokens(messages), 8 + estimateTokens(JSON.stringify(toolCalls)));
  const tools = [buildDocumentTool()];
  assertEquals(estimatePromptTokens(messages, tools), estimatePromptTokens(messages) + estimateTokens(JSON.stringify(tools)));
});

Deno.test("roomLeft: the window less the 256 margin, the prompt and the reply; negative when over", () => {
  assertEquals(roomLeft(8_192, 2_000, 4_000), 1_936);
  assertEquals(roomLeft(8_192, 5_000, 4_000), -1_064);
});

Deno.test("fitReply: the budget when it fits, the room left (less 256) when tighter, null under the minimum", () => {
  assertEquals(fitReply(16_384, 2_000, 4_000, 500), 4_000);
  assertEquals(fitReply(8_192, 5_000, 4_000, 500), 2_936); // 8,192 − 256 margin − 5,000
  assertEquals(fitReply(8_192, 7_800, 4_000, 500), null);
});

const NOTE = " [cut]"; // 6 bytes: 2 tokens

Deno.test("cutToFit: a text within the budget comes back whole", () => {
  assertEquals(cutToFit("x".repeat(30), 10, NOTE), "x".repeat(30));
});

Deno.test("cutToFit: a longer text keeps its start and the note, within the budget", () => {
  const cut = cutToFit("x".repeat(100), 10, NOTE);
  assertEquals(cut, "x".repeat(24) + NOTE); // 8 tokens of text + 2 of note
  assertEquals(estimateTokens(cut), 10);
});

Deno.test("cutToFit: never splits a character", () => {
  // 11 tokens: 27 bytes of text, which would end inside the 14th é (2 bytes) and the 7th 🙂 (4 bytes).
  assertEquals(cutToFit("é".repeat(50), 11, NOTE), "é".repeat(13) + NOTE);
  assertEquals(cutToFit("🙂".repeat(20), 11, NOTE), "🙂".repeat(6) + NOTE);
});

Deno.test("cutToFit: no room beyond the note leaves the note alone", () => {
  assertEquals(cutToFit("x".repeat(100), 2, NOTE), NOTE);
  assertEquals(cutToFit("x".repeat(100), -50, NOTE), NOTE);
});

Deno.test("fitWindow: the reply's max_tokens in a known window, or the 400 naming the model and its window", () => {
  const messages: LLMMessage[] = [{ role: "user", content: "x".repeat(1_500) }]; // 508 tokens
  assertEquals(fitWindow({ model: "ollama/sylou-nemo-16k", contextTokens: 1_000, messages, budget: 4_000, minReply: 100 }), {
    maxTokens: 236,
  });
  const tooLong = fitWindow({ model: "ollama/sylou-nemo-16k", contextTokens: 700, messages, budget: 4_000, minReply: 100 });
  assert("error" in tooLong && tooLong.status === 400 && tooLong.error.includes("window of 700 tokens"), JSON.stringify(tooLong));
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
