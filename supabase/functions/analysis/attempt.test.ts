// analysis/attempt.test.ts — pins for the lifted attempt machinery
// (P4-1 Phase D split). Covers the pillar-shape validator and the
// failed-attempt billing contract (P3-7c: a failed attempt bills BOTH
// the token_usage history row — RLS user client — and the budget
// counter — service-role RPC — and never throws into the caller's
// prepared error response). attemptFlowCall itself calls callLLM
// directly and is exercised by deploy smoke, not unit-faked here.
// Fakes follow the persist.test.ts pattern.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { billFailedAttempt, isValidPillar } from "./attempt.ts";

// --- isValidPillar ----------------------------------------------------------

Deno.test("isValidPillar accepts the pillar shape (score not required — validated separately)", () => {
  assert(isValidPillar({ reasoning: "r", evidence: ["e1", "e2"], narrative: "n" }));
  assert(isValidPillar({ reasoning: "r", evidence: [], narrative: "n", score: 3.5 }));
});

Deno.test("isValidPillar rejects malformed pillars", () => {
  assertEquals(isValidPillar(null), false);
  assertEquals(isValidPillar("stringified"), false);
  assertEquals(isValidPillar({ reasoning: "r", evidence: "not-array", narrative: "n" }), false);
  assertEquals(isValidPillar({ reasoning: "r", evidence: [] }), false); // missing narrative
});

// --- billFailedAttempt ------------------------------------------------------

type Call = { client: string; op: string; table?: string; fn?: string; values?: Record<string, unknown> };

function makeFakes(opts: { usageError?: unknown; rpcError?: unknown; insertThrows?: boolean } = {}) {
  const calls: Call[] = [];
  const supabase = {
    from: (table: string) => ({
      insert: (values: Record<string, unknown>) => {
        if (opts.insertThrows) throw new Error("boom");
        calls.push({ client: "user", op: "insert", table, values });
        return Promise.resolve({ error: opts.usageError ?? null });
      },
    }),
  };
  const adminSupabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ client: "admin", op: "rpc", fn, values: args });
      return Promise.resolve({ error: opts.rpcError ?? null });
    },
  };
  const deps = { supabase, adminSupabase, userId: "u-1", projectId: "p-1", flowModel: "test-model" };
  return { calls, deps };
}

Deno.test("bills history row (user client) then budget RPC (admin client) with summed amount", async () => {
  const { calls, deps } = makeFakes();
  await billFailedAttempt("analysis:refusal", { input_tokens: 120, output_tokens: 30 }, deps);
  assertEquals(calls.length, 2);
  assertEquals(calls[0], {
    client: "user", op: "insert", table: "token_usage",
    values: {
      user_id: "u-1", project_id: "p-1", function_name: "analysis:refusal",
      model_used: "test-model", input_tokens: 120, output_tokens: 30,
    },
  });
  assertEquals(calls[1], {
    client: "admin", op: "rpc", fn: "increment_tokens_used",
    values: { user_uuid: "u-1", amount: 150 },
  });
});

Deno.test("missing usage fields default to 0", async () => {
  const { calls, deps } = makeFakes();
  await billFailedAttempt("analysis:schema_invalid", {}, deps);
  assertEquals(calls[0].values?.input_tokens, 0);
  assertEquals(calls[1].values?.amount, 0);
});

Deno.test("a token_usage insert error is log-only — the RPC still runs, nothing throws", async () => {
  const { calls, deps } = makeFakes({ usageError: { message: "denied" } });
  await billFailedAttempt("analysis:failed", { input_tokens: 1 }, deps);
  assertEquals(calls.length, 2, "budget RPC must still fire after a failed history insert");
});

Deno.test("an RPC error never throws into the caller", async () => {
  const { deps } = makeFakes({ rpcError: { message: "rpc down" } });
  await billFailedAttempt("analysis:failed", {}, deps); // must resolve
});

Deno.test("a thrown client error is swallowed (the prepared 502 must not be masked)", async () => {
  const { deps } = makeFakes({ insertThrows: true });
  await billFailedAttempt("analysis:failed", { input_tokens: 5 }, deps); // must resolve
});
