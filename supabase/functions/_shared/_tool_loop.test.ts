// Deno unit tests for the shared tool-resolution loop.
// Run with: deno test --allow-read supabase/functions/_shared/_tool_loop.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { finalCallTools, promptChars, ROUND_LIMIT_NOTE, runToolLoop, type ToolLoopDeps } from "./_tool_loop.ts";
import type { LLMMessage, LLMTool } from "./_llm.ts";

// Document reads always succeed, so no network is needed.
const docClient = {
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { extracted_text: "Doc text", file_name: "notes.pdf" } }),
        }),
      }),
    }),
  }),
};

// An OpenAI-shape completion (the Mistral path in normaliseResponse):
// one document read per id, or a plain answer when there are none.
function completion(toolCallIds: string[]): Response {
  const message = toolCallIds.length
    ? {
      role: "assistant",
      content: "",
      tool_calls: toolCallIds.map((id) => ({
        id,
        type: "function",
        function: { name: "read_imported_document", arguments: JSON.stringify({ document_id: "doc-1" }) },
      })),
    }
    : { role: "assistant", content: "Final answer." };
  const finish_reason = toolCallIds.length ? "tool_calls" : "stop";
  return new Response(JSON.stringify({ choices: [{ message, finish_reason }], usage: {} }), { status: 200 });
}

function makeDeps(llm: ToolLoopDeps["llm"], toolMessages: LLMMessage[]): ToolLoopDeps {
  return {
    toolMessages,
    toolCalls: [{ id: "call-0", name: "read_imported_document", arguments: { document_id: "doc-1" } }],
    documentsReferenced: [],
    webSearchesPerformed: [],
    emitPhase: () => {},
    adminSupabase: docClient,
    projectId: "project-1",
    chatModel: "mistral-small-2603",
    chatMaxTokens: 1000,
    tools: [],
    temperature: undefined,
    thinking: undefined,
    effort: undefined,
    mistralEffort: undefined,
    logTag: "[test]",
    llm,
  };
}

const toolResults = (messages: LLMMessage[]) => messages.filter((m) => m.role === "tool");

Deno.test("tool loop: stops asking once the model answers without tools", async () => {
  let checkCalls = 0;
  const toolMessages: LLMMessage[] = [];
  await runToolLoop(makeDeps(() => {
    checkCalls++;
    return Promise.resolve(completion([]));
  }, toolMessages));

  assertEquals(checkCalls, 1);
  assertEquals(toolResults(toolMessages).length, 1);
  assert(!String(toolMessages.at(-1)?.content).includes(ROUND_LIMIT_NOTE));
});

Deno.test("tool loop: runs at most 5 rounds and tells the model to answer on the last", async () => {
  let checkCalls = 0;
  const toolMessages: LLMMessage[] = [];
  await runToolLoop(makeDeps(() => {
    checkCalls++;
    return Promise.resolve(completion([`call-${checkCalls}`]));
  }, toolMessages));

  // A check call follows rounds 1-4; none follows the last round.
  assertEquals(checkCalls, 4);
  assertEquals(toolResults(toolMessages).length, 5);
  assert(String(toolMessages.at(-1)?.content).endsWith(`\n\n${ROUND_LIMIT_NOTE}`));
  assertEquals(toolMessages.filter((m) => String(m.content).includes(ROUND_LIMIT_NOTE)).length, 1);
});

Deno.test("tool loop: every tool call gets exactly one result, in order", async () => {
  const toolMessages: LLMMessage[] = [];
  let checkCalls = 0;
  await runToolLoop(makeDeps(() => {
    checkCalls++;
    return Promise.resolve(completion(checkCalls === 1 ? ["call-a", "call-b"] : []));
  }, toolMessages));

  assertEquals(toolResults(toolMessages).map((m) => m.tool_call_id), ["call-0", "call-a", "call-b"]);
});

Deno.test("promptChars: counts text, non-text content and echoed tool calls", () => {
  const toolCalls = [{ id: "c1", type: "function" as const, function: { name: "web_search", arguments: "{\"query\":\"x\"}" } }];
  const messages: LLMMessage[] = [
    { role: "system", content: "abc" },
    { role: "assistant", content: "", tool_calls: toolCalls },
    { role: "assistant", content: [{ type: "text", text: "hi" }] },
  ];
  assertEquals(
    promptChars(messages),
    3 + JSON.stringify(toolCalls).length + JSON.stringify([{ type: "text", text: "hi" }]).length,
  );
});

Deno.test("tool loop: counts the whole re-sent prompt of every check call", async () => {
  const toolMessages: LLMMessage[] = [{ role: "system", content: "S".repeat(1000) }];
  const promptsSeen: number[] = [];
  const { inputCharsAdded } = await runToolLoop(makeDeps((opts) => {
    promptsSeen.push(promptChars(opts.messages));
    return Promise.resolve(completion(promptsSeen.length === 1 ? ["call-a"] : []));
  }, toolMessages));

  // Two check calls, each re-sending the system prompt and everything so far;
  // the tool results are not counted a second time on their own.
  assertEquals(promptsSeen.length, 2);
  assert(promptsSeen.every((size) => size > 1000));
  assertEquals(inputCharsAdded, promptsSeen[0] + promptsSeen[1]);
});

Deno.test("finalCallTools: Anthropic keeps the tool list with tool_choice none; the other providers send nothing", () => {
  const tools: LLMTool[] = [{ type: "function", function: { name: "web_search", description: "d", parameters: {} } }];
  assertEquals(finalCallTools("claude-opus-4-8", tools), { tools, tool_choice: "none" });
  assertEquals(finalCallTools("claude-sonnet-5-5", tools), { tools, tool_choice: "none" });
  for (const model of ["zai-glm-5-3", "mistral-medium-3-5", "deepseek-v4-flash"]) {
    assertEquals(finalCallTools(model, tools), {}, model);
  }
});
