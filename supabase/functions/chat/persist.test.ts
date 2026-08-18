// chat/persist.test.ts — sequence pins for the unified chat persistence
// (P4-1 chat split, cut C). Fakes follow the context-prompt
// persist.test.ts pattern: a hand-rolled chained-builder admin client
// recording one ordered call log. A red test means the persistence
// contract changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type ChatPersistCtx, persistChatExchange } from "./persist.ts";

type Call = { op: string; table?: string; fn?: string; values?: Record<string, unknown> };

function makeFakes(
  opts: { userInsertError?: unknown; assistantInsertError?: unknown; rpcError?: unknown } = {},
) {
  const calls: Call[] = [];
  let insertCount = 0;
  const admin = {
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => ({
        select: () => ({
          single: () => {
            insertCount++;
            const err = insertCount === 1
              ? opts.userInsertError ?? null
              : opts.assistantInsertError ?? null;
            calls.push({ op: "insert", table, values });
            return Promise.resolve({
              data: err ? null : { id: `row-${insertCount}`, ...values },
              error: err,
            });
          },
        }),
      }),
      select: (cols: string) => ({
        eq: (_c: string, _v: string) => ({
          single: () => {
            calls.push({ op: "stats-select", table });
            return Promise.resolve({ data: { [cols]: 2 } });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_c: string, _v: string) => {
          calls.push({ op: "stats-update", table, values });
          return Promise.resolve({ error: null });
        },
      }),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ op: "rpc", fn, values: args });
      return Promise.resolve({ error: opts.rpcError ?? null });
    },
  };
  const ctx: ChatPersistCtx = {
    admin,
    threadId: "t-1",
    projectId: "p-1",
    userId: "u-1",
    monthlyTokenBudget: 1_000_000,
    tokensUsedThisPeriod: 100,
    chatModel: "test-model",
    conciseMode: false,
    tutorMode: false,
    message: "  hello there  ",
  };
  return { calls, ctx };
}

Deno.test("happy path: insert → insert → billing RPC → awaited prompt count, in order", async () => {
  const { calls, ctx } = makeFakes();
  const res = await persistChatExchange(ctx, "answer", 100, 20);
  assertEquals(calls.map((c) => c.op), ["insert", "insert", "rpc", "stats-select", "stats-update"]);
  // User row: trimmed message, no model_used.
  assertEquals(calls[0].values, {
    thread_id: "t-1", role: "user", content: "hello there",
    source_type: "chat", flow_flag: "normal", concise_mode: false, tutor_mode: false,
  });
  // Assistant row carries the final text and model_used.
  assertEquals(calls[1].values?.content, "answer");
  assertEquals(calls[1].values?.model_used, "test-model");
  // Estimate: ceil((100+20)/4) = 30; billed for the caller's user id.
  assertEquals(calls[2].fn, "increment_tokens_used");
  assertEquals(calls[2].values, { user_uuid: "u-1", amount: 30 });
  // Count: normal-mode column read at 2, written at 3.
  assertEquals(calls[4].values, { chat_prompt_count_normal: 3 });
  assertEquals(res.persistenceFailed, false);
  assertEquals(res.estimatedTokens, 30);
  assertEquals(res.newTotal, 130);
  assert(res.insertedUser && res.insertedAssistant);
});

Deno.test("tutor mode targets the tutor count column", async () => {
  const { calls, ctx } = makeFakes();
  await persistChatExchange({ ...ctx, tutorMode: true }, "x", 4, 0);
  const update = calls.find((c) => c.op === "stats-update");
  assertEquals(update?.values, { chat_prompt_count_tutor: 3 });
});

Deno.test("tool arrays attach only when non-empty", async () => {
  const { calls, ctx } = makeFakes();
  await persistChatExchange(ctx, "x", 4, 0, {
    documentsReferenced: ["d-1"], webSearchesPerformed: [],
  });
  assertEquals(calls[1].values?.documents_referenced, ["d-1"]);
  assert(!("web_searches_performed" in (calls[1].values ?? {})));
});

Deno.test("a failed user insert flips persistenceFailed but never blocks billing or count", async () => {
  const { calls, ctx } = makeFakes({ userInsertError: { message: "denied" } });
  const res = await persistChatExchange(ctx, "x", 8, 0);
  assertEquals(res.persistenceFailed, true);
  assertEquals(res.insertedUser, null);
  assertEquals(calls.map((c) => c.op), ["insert", "insert", "rpc", "stats-select", "stats-update"]);
});

Deno.test("a billing RPC error is log-only — count still runs, nothing throws", async () => {
  const { calls, ctx } = makeFakes({ rpcError: { message: "rpc down" } });
  const res = await persistChatExchange(ctx, "x", 4, 0);
  assertEquals(res.persistenceFailed, false);
  assert(calls.some((c) => c.op === "stats-update"));
});

Deno.test("finals are caller-computed params: zeros bill zero (the accumulator contract)", async () => {
  // The running accumulators are zero on the no-tools paths — callers
  // MUST pass their own recomputed finals (and fold the tool-loop's
  // returned counters in on the tool path). Zeros in = zero billed.
  const { calls, ctx } = makeFakes();
  const res = await persistChatExchange(ctx, "x", 0, 0);
  assertEquals(calls[2].values?.amount, 0);
  assertEquals(res.newTotal, 100);
});
