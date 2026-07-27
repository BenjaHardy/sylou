// context-prompt/persist.ts — the single Ask/Propose persistence sequence
// (P4-1 Phase C / B5).
//
// Unifies what were three near-identical copies in index.ts: the streaming
// persistResults closure and the two non-streaming inline tails. This file
// is the "persist" piece of the planned Phase D context-prompt split,
// landed one phase early because the sequence-pinning tests below cannot
// import index.ts (importing it executes Deno.serve).
//
// CONTRACT (CLAUDE.md §4 / TRANSPARENCY.md §5.1 — pinned by
// persist.test.ts; a red test means the transparency contract changed and
// needs a checkpoint, not a test edit):
//   - Delivery-time logging for Ask AND Propose alike; dismissals and
//     disconnects don't unlog an exchange.
//   - Ask never gets an ai_editor_actions row; Propose gets one with
//     outcome 'pending' (CONFIRM later records only the decision).
//   - Two summary destinations, deliberately split: the per-turn DELTA
//     (summaryUpdate) goes to chat flagged 'not_assessed' (fed to FLOW);
//     the FULL merged summary (updatedSummary) goes only to
//     writing_summary_log (withheld from FLOW).
//   - Client split: the service-role client writes the FLOW-input tables
//     (ai_editor_actions, chat_messages, writing_summary_log) behind the
//     caller's upfront ownership checks; token_usage + the billing RPC go
//     through the RLS-scoped user client.
//   - Core-write failures flip persistenceFailed (callers report
//     "Messages may not have been saved." instead of success); secondary
//     writes (token_usage, billing RPC, prompt count) are log-only.
//   - NO try/catch in here: a throw must keep each caller's semantics
//     (streaming: done-error event; non-streaming: outer catch → 500).
//   - Response/done construction stays entirely caller-side.
//
// Phase C normalizations vs the former copies (all disclosed in the PR):
// prompt-count runs LAST in all paths now (the non-streaming copies ran it
// before the message block — deliberate D1 decision, 2026-07-27); the
// non-streaming copies' `persistenceFailed = !!actionErr` assignment and
// unprefixed ledger log, and the no-tools copy's unconditional response
// row, are normalized to the streaming form (all behavior-equivalent).
//
// The mutating per-request char counters are deliberately NOT part of
// PersistCtx — callers pass their FINAL values per call, because the
// totals mutate between request start and persistence on tool paths.

import { sliceSafe } from "../_shared/_text.ts";
import { incrementPromptCount } from "../_shared/_stats.ts";

type Row = Record<string, unknown>;

// Minimal structural view of the supabase clients (the concrete client's
// generic instance type does not cross module boundaries cleanly — same
// approach as _billing.ts/_stats.ts). insert() is both awaitable and
// select()-able because the summary-log insert is awaited directly while
// every other insert chains .select().single().
type WriteClient = {
  from: (table: string) => {
    insert: (values: Row) => PromiseLike<{ error: unknown }> & {
      select: (cols?: string) => {
        single: () => PromiseLike<{ data: { id: string } | null; error: unknown }>;
      };
    };
    update: (values: Row) => {
      eq: (col: string, v: string) => PromiseLike<{ error: unknown }>;
    };
  };
  rpc: (fn: string, args: Row) => PromiseLike<{ error: unknown }>;
};

export interface PersistCtx {
  /** Service-role client — ai_editor_actions, chat_messages,
   *  writing_summary_log, prompt count. */
  admin: unknown;
  /** RLS-scoped user client — token_usage insert + billing RPC only. */
  userClient: unknown;
  userId: string;
  monthlyTokenBudget: number | null;
  tokensUsedThisPeriod: number;
  projectId: string;
  threadId: string;
  /** "ask" | "propose" — validated upstream. */
  actionType: string;
  selectedText: string;
  instruction: string;
  selectedTextSource: string | undefined;
  chatModel: string;
  conciseMode: boolean;
  tutorMode: boolean;
  /** The per-turn summary DELTA — chat message + ledger proposed_summary;
   *  the literal "No update needed." gates both summary writes off. */
  summaryUpdate: string;
  /** The FULL merged summary — writing_summary_log only. */
  updatedSummary: string;
  /** Existing writing_summary_log row, if any (drives update-vs-insert). */
  summaryRow: { id: string } | null;
  /** Populated by the tool loops before any persistence call fires;
   *  captured by reference (const arrays), which is safe. */
  documentsReferenced: string[];
  webSearchesPerformed: string[];
}

export interface PersistResult {
  actionRow: { id: string } | null;
  budgetRemaining: number | null;
  insertedMessages: unknown[];
  persistenceFailed: boolean;
  /** ceil((finalInputChars + finalOutputChars) / 4) — the non-streaming
   *  callers expose this as `tokens_used`; streaming callers ignore it. */
  totalTokens: number;
}

export async function persistContextExchange(
  ctx: PersistCtx,
  aiResponse: string,
  finalInputChars: number,
  finalOutputChars: number,
): Promise<PersistResult> {
  const admin = ctx.admin as WriteClient;
  const userClient = ctx.userClient as WriteClient;
  const totalTokens = Math.ceil((finalInputChars + finalOutputChars) / 4);

  // Core writes (action row, chat messages, summary log) flip this and
  // the caller reports failure instead of success; secondary writes
  // (token_usage, billing RPC) are logged loudly but never fail the
  // exchange.
  let persistenceFailed = false;

  // Only Propose gets a ledger row: it carries the decision that the
  // pending-gated CONFIRM endpoint records, and feeds the FLOW outcome
  // statistics. Ask has no decision to record — its full exchange is
  // logged in the chat below, which is its canonical (and only) record.
  let actionRow: { id: string } | null = null;
  if (ctx.actionType !== "ask") {
    const { data: insertedAction, error: actionErr } = await admin
      .from("ai_editor_actions")
      .insert({
        project_id: ctx.projectId,
        action_type: "propose",
        selected_text_preview: sliceSafe(ctx.selectedText, 500),
        ai_response_preview: sliceSafe(aiResponse, 500),
        ai_response_full: aiResponse,
        proposed_summary: ctx.summaryUpdate,
        char_count_original: ctx.selectedText.length,
        char_count_result: aiResponse.length,
        outcome: "pending",
        instruction_text: ctx.selectedTextSource
          ? `${sliceSafe(ctx.instruction, 1000)} | Source: ${ctx.selectedTextSource}`
          : sliceSafe(ctx.instruction, 1000),
      })
      .select("id")
      .single();
    if (actionErr) {
      console.error("[context-prompt] ai_editor_actions insert failed:", JSON.stringify(actionErr));
      persistenceFailed = true;
    }
    actionRow = insertedAction;
  }

  const { error: usageErr } = await userClient.from("token_usage").insert({
    user_id: ctx.userId,
    project_id: ctx.projectId,
    function_name: "context-prompt",
    model_used: ctx.chatModel,
    input_tokens: Math.ceil(finalInputChars / 4),
    output_tokens: Math.ceil(finalOutputChars / 4),
  });
  if (usageErr) console.error("[context-prompt] token_usage insert failed:", JSON.stringify(usageErr));

  const { error: rpcErr } = await userClient.rpc("increment_tokens_used", {
    user_uuid: ctx.userId,
    amount: totalTokens,
  });
  if (rpcErr) console.error("[context-prompt] increment_tokens_used failed:", JSON.stringify(rpcErr));

  const budgetRemaining: number | null = ctx.monthlyTokenBudget === null
    ? null
    : ctx.monthlyTokenBudget - ctx.tokensUsedThisPeriod - totalTokens;

  const insertedMessages: unknown[] = [];

  // Log the exchange at delivery for Ask AND Propose alike (deliberate
  // contract — TRANSPARENCY.md §5.1): the user reads the reply either
  // way, so it goes on the record here, server-side (surviving
  // dismissals, tab closes and disconnects). For Propose, the CONFIRM
  // endpoint afterwards records only the decision.
  {
    const isAsk = ctx.actionType === "ask";
    const sourceNote = ctx.selectedTextSource ? ` Source: ${ctx.selectedTextSource}.` : "";
    const userPromptContent = `[${isAsk ? "Ask" : "Propose"}] Selected: "${sliceSafe(ctx.selectedText, 200)}${ctx.selectedText.length > 200 ? "…" : ""}"${sourceNote}\n${isAsk ? "Question" : "Instruction"}: ${ctx.instruction}`;

    const { data: promptMsg, error: promptErr } = await admin.from("chat_messages").insert({
      thread_id: ctx.threadId,
      role: "user",
      content: userPromptContent,
      source_type: isAsk ? "ask_prompt" : "propose_prompt",
      flow_flag: "normal",
      concise_mode: ctx.conciseMode,
      tutor_mode: ctx.tutorMode,
    }).select().single();
    if (promptErr) {
      console.error("[context-prompt] prompt message insert failed:", JSON.stringify(promptErr));
      persistenceFailed = true;
    }
    if (promptMsg) insertedMessages.push(promptMsg);

    if (ctx.summaryUpdate !== "No update needed.") {
      // writing_summary intentionally omits concise_mode and tutor_mode (defaults to false):
      // the summary is produced by LLM #1 which never receives the CONCISE_MODE_MODIFIER
      // nor the tutor-mode system prompt.
      const { data: summaryMsg, error: summaryMsgErr } = await admin.from("chat_messages").insert({
        thread_id: ctx.threadId,
        role: "assistant",
        content: ctx.summaryUpdate,
        source_type: "writing_summary",
        flow_flag: "not_assessed",
      }).select().single();
      if (summaryMsgErr) {
        console.error("[context-prompt] summary message insert failed:", JSON.stringify(summaryMsgErr));
        persistenceFailed = true;
      }
      if (summaryMsg) insertedMessages.push(summaryMsg);
    }

    const responseRow: Row = {
      thread_id: ctx.threadId,
      role: "assistant",
      content: aiResponse,
      source_type: isAsk ? "ask_response" : "propose_response",
      flow_flag: "normal",
      model_used: ctx.chatModel,
      concise_mode: ctx.conciseMode,
      tutor_mode: ctx.tutorMode,
    };
    if (ctx.documentsReferenced.length > 0) {
      responseRow.documents_referenced = ctx.documentsReferenced;
    }
    if (ctx.webSearchesPerformed.length > 0) {
      responseRow.web_searches_performed = ctx.webSearchesPerformed;
    }

    const { data: responseMsg, error: responseErr } = await admin.from("chat_messages").insert(responseRow).select().single();
    if (responseErr) {
      console.error("[context-prompt] response message insert failed:", JSON.stringify(responseErr));
      persistenceFailed = true;
    }
    if (responseMsg) insertedMessages.push(responseMsg);

    if (ctx.summaryUpdate !== "No update needed.") {
      if (ctx.summaryRow) {
        const { error: logErr } = await admin
          .from("writing_summary_log")
          .update({ summary_text: ctx.updatedSummary, last_updated_at: new Date().toISOString() })
          .eq("id", ctx.summaryRow.id);
        if (logErr) {
          console.error("[context-prompt] writing_summary_log update failed:", JSON.stringify(logErr));
          persistenceFailed = true;
        }
      } else {
        const { error: logErr } = await admin.from("writing_summary_log").insert({
          project_id: ctx.projectId,
          summary_text: ctx.updatedSummary,
        });
        if (logErr) {
          console.error("[context-prompt] writing_summary_log insert failed:", JSON.stringify(logErr));
          persistenceFailed = true;
        }
      }
    }
  }

  // Count this Ask/Propose exchange as a prompt (policy 2026-07-27:
  // chat + Ask/Propose count; editor actions and CONFIRM do not).
  // Unconditional like chat's counters — a failed message insert
  // doesn't uncount the exchange; failures are log-only. Runs LAST in
  // every path (D1 normalization: count only once the exchange is on
  // the record).
  await incrementPromptCount(ctx.admin, ctx.projectId, ctx.tutorMode, "[context-prompt]");

  return { actionRow, budgetRemaining, insertedMessages, persistenceFailed, totalTokens };
}
