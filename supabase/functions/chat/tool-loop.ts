// chat/tool-loop.ts — the tool-resolution loop for the chat function's
// two-pass streaming flow (P4-1 chat split, cut D). Param-lifted from
// index.ts; body verbatim except six recorded substitutions (dedent, the
// two char-counter renames, one projectId rename, and the two phase
// enqueues becoming the emitPhase callback — the callback OWNS the
// client-gone guard). Hashes in the commit msg.
//
// Contract notes (P3-7e): every echoed tool_call MUST be answered —
// calls past the per-turn limit and unknown tool names get stub results,
// or the follow-up request 400s on unpaired ids. All five tool-result
// string shapes are provider-visible and byte-frozen (one carries an em
// dash). A failed intermediate call silently ends the loop (no log, no
// error event) and falls through to Call #2 with the accumulated
// messages — deliberate, preserved.
//
// The char counters RETURN as values: numbers cannot mutate across a
// module boundary. The caller MUST fold {inputCharsAdded,
// outputCharsAdded} into its running totals — forgetting compiles clean
// and silently under-bills (chat/persist.test.ts pins the fold-in).
// toolMessages / documentsReferenced / webSearchesPerformed mutate by
// reference on purpose (the cp persist.ts precedent).

import {
  callLLM,
  cleanLLMContent,
  normaliseResponse,
  providerFor,
  type LLMMessage,
  type LLMTool,
  type NormalisedResponse,
} from "../_shared/_llm.ts";
import { formatWebSearchResults, searchWeb } from "../_shared/_tools.ts";

// Minimal structural view of the admin client (the concrete client's
// generic instance type does not cross module boundaries cleanly — the
// persist.ts/_stats.ts precedent).
type DocReadClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => {
        eq: (col: string, v: string) => {
          maybeSingle: () => PromiseLike<
            { data: { extracted_text: string | null; file_name: string } | null }
          >;
        };
      };
    };
  };
};

export interface ToolLoopDeps {
  /** Grows by reference: tool results + intermediate assistant turns. */
  toolMessages: LLMMessage[];
  /** Call #1's tool calls — seeds the loop. */
  toolCalls: NormalisedResponse["toolCalls"];
  /** Mutated by reference; persisted on the assistant row later. */
  documentsReferenced: string[];
  webSearchesPerformed: string[];
  /** Owns the enqueue try/catch (client-gone guard stays caller-side). */
  emitPhase: (phase: "reading_documents" | "searching_web") => void;
  adminSupabase: unknown;
  projectId: string;
  chatModel: string;
  chatMaxTokens: number;
  tools: LLMTool[];
  temperature: number | undefined;
  thinking: Parameters<typeof callLLM>[0]["thinking"];
  effort: Parameters<typeof callLLM>[0]["effort"];
  mistralEffort: Parameters<typeof callLLM>[0]["mistral_effort"];
}

/** Runs the iterative tool-resolution loop; returns the char counts the
 *  caller must fold into its billing totals. */
export async function runToolLoop(
  deps: ToolLoopDeps,
): Promise<{ inputCharsAdded: number; outputCharsAdded: number }> {
  const {
    toolMessages, toolCalls, documentsReferenced, webSearchesPerformed,
    emitPhase, projectId, chatModel, chatMaxTokens, tools, temperature,
    thinking, effort, mistralEffort,
  } = deps;
  const adminSupabase = deps.adminSupabase as DocReadClient;
  let inputCharsAdded = 0;
  let outputCharsAdded = 0;

  // Resolve tool calls iteratively (up to 5 iterations)
  let iteration = 0;
  const MAX_ITERATIONS = 5;
  // Real executions per assistant turn; calls past this (and
  // unknown tool names) still get a stub result — every echoed
  // tool_call MUST be answered or the follow-up request 400s
  // for the unpaired ids (P3-7e).
  const TOOL_CALL_LIMIT = 5;
  let currentToolCalls = toolCalls;

  while (currentToolCalls.length > 0 && iteration < MAX_ITERATIONS) {
    iteration++;
    console.log(`[stream] tool iteration ${iteration}, ${currentToolCalls.length} calls`);

    for (const [tcIndex, tc] of currentToolCalls.entries()) {
      if (tcIndex >= TOOL_CALL_LIMIT) {
        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Not executed: per-turn tool-call limit reached. Ask again in a follow-up if still needed.",
        });
      } else if (tc.name === "read_imported_document") {
        const docId = tc.arguments.document_id as string;
        console.log("[stream] reading document:", docId);
        documentsReferenced.push(docId);

        emitPhase("reading_documents");

        const { data: docData } = await adminSupabase
          .from("imported_documents")
          .select("extracted_text, file_name")
          .eq("id", docId)
          .eq("project_id", projectId)
          .maybeSingle();

        const toolResult = docData?.extracted_text
          ? `Document "${docData.file_name}":\n\n${docData.extracted_text}`
          : `Document not found in this project or text not yet extracted.`;

        inputCharsAdded += toolResult.length;

        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });
      } else if (tc.name === "web_search") {
        const query = tc.arguments.query as string;
        console.log("[stream] web search:", query);
        webSearchesPerformed.push(query);

        emitPhase("searching_web");

        const results = await searchWeb(query);
        const toolResult = formatWebSearchResults(query, results);
        inputCharsAdded += toolResult.length;

        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });
      } else {
        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: `Unknown tool "${tc.name}" — not executed.`,
        });
      }
    }

    // Check if the LLM wants to make more tool calls
    if (iteration < MAX_ITERATIONS) {
      const nextRes = await callLLM({
          model: chatModel,
          messages: toolMessages,
          max_tokens: chatMaxTokens,
          tools,
          temperature,
          thinking,
          effort,
          mistral_effort: mistralEffort,
        });

      if (!nextRes.ok) {
        currentToolCalls = [];
        break;
      }

      const nextData = await nextRes.json();
      const nextNorm = normaliseResponse(providerFor(chatModel), nextData);
      const nextContent = cleanLLMContent(nextNorm.text);
      outputCharsAdded += nextContent.length;
      currentToolCalls = nextNorm.toolCalls;

      if (currentToolCalls.length > 0) {
        toolMessages.push(nextNorm.assistantMessage);
      } else {
        // No more tool calls — discard any text from intermediate call
        // and fall through to a proper streaming Call #2
        break;
      }
    }
  }

  return { inputCharsAdded, outputCharsAdded };
}
