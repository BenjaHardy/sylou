// Deno unit tests for the shared tool-resolution loop.
// Run with: deno test --allow-read supabase/functions/_shared/_tool_loop.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ROUND_LIMIT_NOTE, runToolLoop, type ToolLoopDeps } from "./_tool_loop.ts";
import type { LLMMessage } from "./_llm.ts";

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
