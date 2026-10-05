// _shared/_tool_loop.ts — the tool-resolution loop shared by chat and
// context-prompt (moved from chat/tool-loop.ts). After each round of tool
// calls it asks the model again, tools still offered, until the model
// stops calling them or MAX_ITERATIONS rounds have run; the caller then
// makes its final streaming call, whose tool fields finalCallTools decides.
//
// Contract notes (P3-7e): every echoed tool_call MUST be answered —
// calls past the per-turn limit and unknown tool names get stub results,
// or the follow-up request 400s on unpaired ids. All five tool-result
// string shapes are provider-visible and byte-frozen (one carries an em
// dash). A failed intermediate call silently ends the loop (no log, no
// error event) and falls through to the caller's final call with the
// accumulated messages — deliberate, preserved.
//
// The last allowed round's final tool result also carries
// ROUND_LIMIT_NOTE: the caller's final call allows no tool call, so a model
// that still wanted another round would otherwise return no text at all.
//
// The char counters RETURN as values: numbers cannot mutate across a
// module boundary. The caller MUST fold {inputCharsAdded,
// outputCharsAdded} into its running totals — forgetting compiles clean
// and silently under-bills (chat/persist.test.ts pins the fold-in).
// Every call re-sends the whole conversation, so inputCharsAdded is the
// full prompt of each check call (tool results are counted inside the
// calls that carry them, never separately); the caller counts its first
// and final calls the same way, with promptChars.
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
} from "./_llm.ts";
import { formatWebSearchResults, searchWeb } from "./_tools.ts";
import { contentLogsEnabled } from "./_debug.ts";

export const ROUND_LIMIT_NOTE =
  "Tool-use limit reached for this request: write your answer now from the information above.";

/** Tool fields for the caller's final, streaming call after the loop. On
 *  every Claude model the tool list stays on the wire with
 *  `tool_choice: "none"`, so the final call's prefix (system prompt, tools,
 *  earlier messages) is the loop's: the preserved-thinking models (Sonnet
 *  5.5, Opus 5.5, Fable 5.1) bind the echoed thinking blocks to it and 400
 *  on an edit for accounts enforced by default, and an identical prefix is
 *  what prompt caching reuses on the others. Mistral and DeepSeek keep the
 *  tool-less final call. */
export function finalCallTools(
  model: string,
  tools: LLMTool[],
): { tools?: LLMTool[]; tool_choice?: "none" } {
  return providerFor(model) === "anthropic" ? { tools, tool_choice: "none" } : {};
}

/** Prompt size in characters for the usage estimate: every message's
 *  content plus any echoed tool calls. */
export function promptChars(messages: LLMMessage[]): number {
  return messages.reduce(
    (sum, m) =>
      sum +
      (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content ?? "").length) +
      (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0),
    0,
  );
}

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
  /** Log prefix, so each function keeps its own log lines. */
  logTag: string;
  /** Replaces callLLM in unit tests. */
  llm?: typeof callLLM;
}

/** Runs the iterative tool-resolution loop; returns the char counts the
 *  caller must fold into its billing totals. */
export async function runToolLoop(
  deps: ToolLoopDeps,
): Promise<{ inputCharsAdded: number; outputCharsAdded: number }> {
  const {
    toolMessages, toolCalls, documentsReferenced, webSearchesPerformed,
    emitPhase, projectId, chatModel, chatMaxTokens, tools, temperature,
    thinking, effort, mistralEffort, logTag,
  } = deps;
  const adminSupabase = deps.adminSupabase as DocReadClient;
  const llm = deps.llm ?? callLLM;
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
    console.log(`${logTag} tool iteration ${iteration}, ${currentToolCalls.length} calls`);

    for (const [tcIndex, tc] of currentToolCalls.entries()) {
      if (tcIndex >= TOOL_CALL_LIMIT) {
        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Not executed: at most 5 tool calls run per round. Make the remaining calls in your next round if still needed.",
        });
      } else if (tc.name === "read_imported_document") {
        const docId = tc.arguments.document_id as string;
        console.log(`${logTag} reading document:`, docId);
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

        toolMessages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });
      } else if (tc.name === "web_search") {
        const query = tc.arguments.query as string;
        console.log(`${logTag} web search:`, contentLogsEnabled() ? query : `(${query.length} chars)`);
        webSearchesPerformed.push(query);

        emitPhase("searching_web");

        const results = await searchWeb(query);
        const toolResult = formatWebSearchResults(query, results);

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

    if (iteration === MAX_ITERATIONS) {
      const last = toolMessages[toolMessages.length - 1];
      last.content = `${last.content}\n\n${ROUND_LIMIT_NOTE}`;
    }

    // Check if the LLM wants to make more tool calls
    if (iteration < MAX_ITERATIONS) {
      const promptSize = promptChars(toolMessages);
      const nextRes = await llm({
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
        break;
      }
      inputCharsAdded += promptSize;

      const nextData = await nextRes.json();
      const nextNorm = normaliseResponse(providerFor(chatModel), nextData);
      const nextContent = cleanLLMContent(nextNorm.text);
      outputCharsAdded += nextContent.length;
      currentToolCalls = nextNorm.toolCalls;

      if (currentToolCalls.length > 0) {
        toolMessages.push(nextNorm.assistantMessage);
      } else {
        // No more tool calls — discard any text from intermediate call
        // and fall through to the caller's streaming final call
        break;
      }
    }
  }

  return { inputCharsAdded, outputCharsAdded };
}
