// chat/persist.ts — the single chat-exchange persistence sequence
// (P4-1 chat split, cut C — the billing-tail unification the campaign
// deferred to this split; _shared/_stats.ts's header reserves the
// prompt-count dedupe for exactly this moment).
//
// Unifies what were four near-identical tails in index.ts (the replay,
// tool, and no-tools streaming tails + the latent non-streaming path).
// CONTRACT (pinned by persist.test.ts; a red test means the contract
// changed — that needs a checkpoint, not a test edit):
//   - Sequence: user insert -> assistant insert -> token estimate ->
//     billing RPC -> prompt count. All on the service-role client
//     (write-surface lockdown; thread ownership verified upstream).
//   - finalInputChars / finalOutputChars are CALLER-computed: the running
//     accumulators are zero on the no-tools paths, and the non-streaming
//     path deliberately bills its defaulted text while the streaming
//     paths bill pre-default content — both preserved by passing finals.
//   - The prompt count is AWAITED on every path (checkpoint D3a: the
//     non-streaming path has no stream keeping the isolate alive, and
//     the streaming paths now match cp's field-proven awaited form).
//     Uses _shared/_stats.incrementPromptCount with logTag "[stream]" —
//     the success line byte-preserves the stale-deploy fingerprint.
//   - Core-write failures flip persistenceFailed (callers report
//     "Messages may not have been saved." instead of success); billing
//     RPC and prompt-count failures are log-only.
//   - NO try/catch in here: a throw must keep each caller's own catch
//     semantics (the tool tail's error string differs from the others).
//   - done/JSON payload construction and the conversation-memory refresh
//     stay entirely caller-side.

import { incrementPromptCount } from "../_shared/_stats.ts";

// Minimal structural view of the admin client (the concrete client's
// generic instance type does not cross module boundaries cleanly — the
// persist.ts/_stats.ts precedent).
type ChatWriteClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => {
      select: () => {
        single: () => PromiseLike<
          { data: Record<string, unknown> | null; error: unknown }
        >;
      };
    };
  };
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
};

export interface ChatPersistCtx {
  /** Service-role client — inserts, billing RPC, prompt count. */
  admin: unknown;
  threadId: string;
  projectId: string;
  userId: string;
  monthlyTokenBudget: number | null;
  tokensUsedThisPeriod: number;
  chatModel: string;
  conciseMode: boolean;
  tutorMode: boolean;
  /** Raw request message; trimmed here exactly as the tails did. */
  message: string;
}

export async function persistChatExchange(
  ctx: ChatPersistCtx,
  finalText: string,
  finalInputChars: number,
  finalOutputChars: number,
  opts: { documentsReferenced?: string[]; webSearchesPerformed?: string[] } = {},
): Promise<{
  insertedUser: Record<string, unknown> | null;
  insertedAssistant: Record<string, unknown> | null;
  persistenceFailed: boolean;
  estimatedTokens: number;
  newTotal: number;
}> {
  const admin = ctx.admin as ChatWriteClient;

  const userMsgRow = {
    thread_id: ctx.threadId,
    role: "user",
    content: ctx.message.trim(),
    source_type: "chat",
    flow_flag: "normal",
    concise_mode: ctx.conciseMode,
    tutor_mode: ctx.tutorMode,
  };
  const assistantMsgRow: Record<string, unknown> = {
    thread_id: ctx.threadId,
    role: "assistant",
    content: finalText,
    source_type: "chat",
    flow_flag: "normal",
    concise_mode: ctx.conciseMode,
    tutor_mode: ctx.tutorMode,
    model_used: ctx.chatModel,
  };

  if (opts.documentsReferenced && opts.documentsReferenced.length > 0) {
    assistantMsgRow.documents_referenced = opts.documentsReferenced;
  }
  if (opts.webSearchesPerformed && opts.webSearchesPerformed.length > 0) {
    assistantMsgRow.web_searches_performed = opts.webSearchesPerformed;
  }

  const { data: insertedUser, error: userMsgErr } = await admin
    .from("chat_messages")
    .insert(userMsgRow)
    .select()
    .single();
  if (userMsgErr) console.error("[chat] user message insert failed:", JSON.stringify(userMsgErr));

  const { data: insertedAssistant, error: assistantMsgErr } = await admin
    .from("chat_messages")
    .insert(assistantMsgRow)
    .select()
    .single();
  if (assistantMsgErr) console.error("[chat] assistant message insert failed:", JSON.stringify(assistantMsgErr));

  const estimatedTokens = Math.ceil((finalInputChars + finalOutputChars) / 4);
  const newTotal = ctx.tokensUsedThisPeriod + estimatedTokens;
  const { error: rpcErr } = await admin.rpc("increment_tokens_used", {
    user_uuid: ctx.userId,
    amount: estimatedTokens,
  });
  if (rpcErr) console.error("[chat] increment_tokens_used failed:", JSON.stringify(rpcErr));

  await incrementPromptCount(ctx.admin, ctx.projectId, ctx.tutorMode, "[stream]");

  return {
    insertedUser,
    insertedAssistant,
    persistenceFailed: !!(userMsgErr || assistantMsgErr),
    estimatedTokens,
    newTotal,
  };
}
