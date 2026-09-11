// Deno unit tests for the Ask/Propose persistence sequence.
// Run with: deno test supabase/functions/context-prompt/persist.test.ts
//
// These pin the CLAUDE.md §4 contract at the exact
// moment the sequence became shared (P4-1 Phase C). A red test here means
// the transparency contract changed — that needs a checkpoint, not a test
// edit.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { persistContextExchange, type PersistCtx } from "./persist.ts";

// ── fakes ────────────────────────────────────────────────────────────

type Call = {
  client: "admin" | "user";
  op: "insert" | "update" | "rpc" | "select";
  table?: string;
  values?: Record<string, unknown>;
};

interface FakeOpts {
  ledgerError?: unknown;
  usageError?: unknown;
  rpcError?: unknown;
  summaryLogError?: unknown;
  /** project_stats row served to incrementPromptCount; null = no row. */
  statsRow?: Record<string, number> | null;
}

/** Builds admin+user fakes sharing one ordered call log. insert() is both
 *  awaitable (summary-log insert, token_usage) and .select().single()-able
 *  (everything else), mirroring the real builder. */
function makeFakes(opts: FakeOpts = {}) {
  const calls: Call[] = [];
  let rowId = 0;

  function makeInsert(client: "admin" | "user", table: string, values: Record<string, unknown>) {
    const err = (table === "ai_editor_actions" ? opts.ledgerError : undefined) ??
      (table === "token_usage" ? opts.usageError : undefined) ??
      (table === "writing_summary_log" ? opts.summaryLogError : undefined) ?? null;
    calls.push({ client, op: "insert", table, values });
    const data = err ? null : { id: `${table}-${++rowId}`, ...values };
    const settled = Promise.resolve({ data, error: err });
    return {
      select: (_cols?: string) => ({ single: () => settled }),
      // deno-lint-ignore no-explicit-any
      then: (onFulfilled: (v: { error: unknown }) => unknown): any =>
        settled.then((r) => onFulfilled({ error: r.error })),
    };
  }

  function makeClient(client: "admin" | "user") {
    return {
      from: (table: string) => ({
        insert: (values: Record<string, unknown>) => makeInsert(client, table, values),
        update: (values: Record<string, unknown>) => ({
          eq: (_col: string, _v: string) => {
            calls.push({ client, op: "update", table, values });
            const err = table === "writing_summary_log" ? (opts.summaryLogError ?? null) : null;
            return Promise.resolve({ error: err });
          },
        }),
        select: (cols: string) => ({
          eq: (_col: string, _v: string) => ({
            single: () => {
              calls.push({ client, op: "select", table, values: { cols } });
              const row = opts.statsRow === undefined ? { [cols]: 0 } : opts.statsRow;
              return Promise.resolve({ data: row ? { ...row } : null });
            },
          }),
        }),
      }),
      rpc: (fn: string, args: Record<string, unknown>) => {
        calls.push({ client, op: "rpc", table: fn, values: args });
        return Promise.resolve({ error: opts.rpcError ?? null });
      },
    };
  }

  return { calls, admin: makeClient("admin"), user: makeClient("user") };
}

function makeCtx(fakes: ReturnType<typeof makeFakes>, overrides: Partial<PersistCtx> = {}): PersistCtx {
  return {
    admin: fakes.admin,
    userClient: fakes.user,
    userId: "user-1",
    monthlyTokenBudget: null,
    tokensUsedThisPeriod: 100,
    projectId: "proj-1",
    threadId: "thread-1",
    actionType: "propose",
    selectedText: "the selected passage",
    instruction: "make it tighter",
    selectedTextSource: undefined,
    chatModel: "claude-sonnet-4-6",
    conciseMode: false,
    tutorMode: false,
    summaryUpdate: "New: intro now argues X.",
    updatedSummary: "FULL SUMMARY: the whole document argues X, then Y.",
    summaryRow: { id: "log-1" },
    documentsReferenced: [],
    webSearchesPerformed: [],
    ...overrides,
  };
}

// ── the contract ─────────────────────────────────────────────────────

Deno.test("propose: full write order, per-write client, prompt count LAST", async () => {
  const fakes = makeFakes();
  const result = await persistContextExchange(makeCtx(fakes), "the proposal", 400, 100);

  assertEquals(
    fakes.calls.map((c) => `${c.client}:${c.op}:${c.table}`),
    [
      "admin:insert:ai_editor_actions",
      "user:insert:token_usage",
      "user:rpc:increment_tokens_used",
      "admin:insert:chat_messages", // prompt
      "admin:insert:chat_messages", // summary delta
      "admin:insert:chat_messages", // response
      "admin:update:writing_summary_log",
      "admin:select:project_stats", // incrementPromptCount…
      "admin:update:project_stats", // …runs last (D1)
    ],
  );
  assert(result.actionRow?.id);
  assertEquals(result.persistenceFailed, false);
  assertEquals(result.insertedMessages.length, 3);
  assertEquals(result.totalTokens, Math.ceil((400 + 100) / 4));
});

Deno.test("ask: no ledger row is ever written (chat is Ask's canonical record)", async () => {
  const fakes = makeFakes();
  const result = await persistContextExchange(makeCtx(fakes, { actionType: "ask" }), "the answer", 40, 10);
  assert(!fakes.calls.some((c) => c.table === "ai_editor_actions"));
  assertEquals(result.actionRow, null);
  const prompt = fakes.calls.find((c) => c.table === "chat_messages");
  assertEquals(prompt?.values?.source_type, "ask_prompt");
});

Deno.test('sentinel "No update needed." skips the summary message AND the summary log', async () => {
  const fakes = makeFakes();
  const result = await persistContextExchange(
    makeCtx(fakes, { summaryUpdate: "No update needed." }),
    "reply",
    40,
    10,
  );
  assert(!fakes.calls.some((c) => c.table === "writing_summary_log"));
  const chatInserts = fakes.calls.filter((c) => c.table === "chat_messages");
  assertEquals(chatInserts.length, 2); // prompt + response only
  assertEquals(result.insertedMessages.length, 2);
});

Deno.test("delta/full split: chat gets the DELTA flagged not_assessed; the log gets the FULL summary", async () => {
  const fakes = makeFakes();
  const ctx = makeCtx(fakes);
  await persistContextExchange(ctx, "reply", 40, 10);

  const summaryMsg = fakes.calls.find(
    (c) => c.table === "chat_messages" && c.values?.source_type === "writing_summary",
  );
  assertEquals(summaryMsg?.values?.content, ctx.summaryUpdate);
  assertEquals(summaryMsg?.values?.flow_flag, "not_assessed");
  assertEquals(summaryMsg?.values?.concise_mode, undefined); // deliberately omitted
  assertEquals(summaryMsg?.values?.tutor_mode, undefined);

  const logWrite = fakes.calls.find((c) => c.table === "writing_summary_log");
  assertEquals(logWrite?.op, "update");
  assertEquals(logWrite?.values?.summary_text, ctx.updatedSummary);
});

Deno.test("no existing summary row: the log write is an INSERT carrying the full summary", async () => {
  const fakes = makeFakes();
  const ctx = makeCtx(fakes, { summaryRow: null });
  await persistContextExchange(ctx, "reply", 40, 10);
  const logWrite = fakes.calls.find((c) => c.table === "writing_summary_log");
  assertEquals(logWrite?.op, "insert");
  assertEquals(logWrite?.values?.summary_text, ctx.updatedSummary);
  assertEquals(logWrite?.values?.project_id, "proj-1");
});

Deno.test("ledger failure: persistenceFailed flips, actionRow null, the rest still runs", async () => {
  const fakes = makeFakes({ ledgerError: { code: "boom" } });
  const result = await persistContextExchange(makeCtx(fakes), "reply", 40, 10);
  assertEquals(result.persistenceFailed, true);
  assertEquals(result.actionRow, null);
  // Chat logging still happened — delivery-time logging survives ledger failure.
  assertEquals(fakes.calls.filter((c) => c.table === "chat_messages").length, 3);
});

Deno.test("token_usage + billing RPC failures are log-only: persistenceFailed stays false", async () => {
  const fakes = makeFakes({ usageError: { code: "u" }, rpcError: { code: "r" } });
  const result = await persistContextExchange(makeCtx(fakes), "reply", 40, 10);
  assertEquals(result.persistenceFailed, false);
});

Deno.test("budgetRemaining: null budget → null; set budget → budget - used - totalTokens", async () => {
  const noCap = await persistContextExchange(makeCtx(makeFakes()), "reply", 400, 100);
  assertEquals(noCap.budgetRemaining, null);

  const fakes = makeFakes();
  const capped = await persistContextExchange(
    makeCtx(fakes, { monthlyTokenBudget: 10_000, tokensUsedThisPeriod: 2_000 }),
    "reply",
    400,
    100,
  );
  assertEquals(capped.budgetRemaining, 10_000 - 2_000 - Math.ceil(500 / 4));
});

Deno.test("doc/web telemetry rides the response row only when non-empty", async () => {
  const withTools = makeFakes();
  await persistContextExchange(
    makeCtx(withTools, { documentsReferenced: ["doc-1"], webSearchesPerformed: ["q"] }),
    "reply",
    40,
    10,
  );
  const responseRow = withTools.calls.filter((c) => c.table === "chat_messages")[2];
  assertEquals(responseRow?.values?.documents_referenced, ["doc-1"]);
  assertEquals(responseRow?.values?.web_searches_performed, ["q"]);

  const without = makeFakes();
  await persistContextExchange(makeCtx(without), "reply", 40, 10);
  const bareRow = without.calls.filter((c) => c.table === "chat_messages")[2];
  assertEquals("documents_referenced" in (bareRow?.values ?? {}), false);
  assertEquals("web_searches_performed" in (bareRow?.values ?? {}), false);
});
