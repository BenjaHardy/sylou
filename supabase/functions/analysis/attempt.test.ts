// analysis/attempt.test.ts — pins for the lifted attempt machinery
// (P4-1 Phase D split). Covers the pillar-shape validator, the
// failed-attempt billing contract (P3-7c: a failed attempt bills BOTH
// the token_usage history row — RLS user client — and the budget
// counter — service-role RPC — and never throws into the caller's
// prepared error response) and, through the `llm` seam, the attempt
// outcomes: a valid tool call, the retry funnel, and the deterministic
// failures (refusal, max_tokens / "length") that must NOT be retried.
// Fakes follow the persist.test.ts pattern.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { attemptFlowCall, billFailedAttempt, isValidPillar, type AttemptDeps } from "./attempt.ts";
import { SUBMIT_FLOW_TOOL } from "./prompts.ts";

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

// --- attemptFlowCall (through the llm seam) ---------------------------------

const PILLAR = { score: 3.5, reasoning: "r", evidence: ["e"], narrative: "n" };
const VALID_ARGS = { summary: "s", find: PILLAR, lead: PILLAR, organize: PILLAR, write: PILLAR };
const NUDGE = "returned as a nested JSON object";

type LlmArgs = Parameters<NonNullable<AttemptDeps["llm"]>>[0];

/** A provider reply as callLLM would hand it back (ok unless `status` says otherwise). */
function reply(body: unknown, status = 200, record?: LlmArgs[]): NonNullable<AttemptDeps["llm"]> {
  return (args) => {
    record?.push(args);
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return Promise.resolve(new Response(text, { status, headers: { "Content-Type": "application/json" } }));
  };
}

/** OpenAI-shape (Mistral) completion: optional tool call, finish reason, usage. */
function mistralBody(opts: { toolArgs?: unknown; finish: string; text?: string }) {
  return {
    choices: [{
      finish_reason: opts.finish,
      message: {
        role: "assistant",
        content: opts.text ?? "",
        ...(opts.toolArgs !== undefined
          ? { tool_calls: [{ id: "t1", function: { name: SUBMIT_FLOW_TOOL.name, arguments: JSON.stringify(opts.toolArgs) } }] }
          : {}),
      },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 20 },
  };
}

function attemptDeps(llm: AttemptDeps["llm"], overrides: Partial<AttemptDeps> = {}): AttemptDeps {
  return {
    baseLlmArgs: {
      model: "zai-glm-5-3",
      messages: [{ role: "system", content: "SYS" }, { role: "user", content: "USER" }],
      max_tokens: 100,
    },
    systemPromptTemplate: "SYS",
    userPrompt: "USER",
    flowModel: "zai-glm-5-3",
    provider: "mistral",
    temperature: 0,
    useStructuredOutputs: false,
    projectId: "p-1",
    jsonResponse: (body, status = 200) => new Response(JSON.stringify(body), { status }),
    llm,
    ...overrides,
  };
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

Deno.test("attemptFlowCall: a valid tool call is ok, with the provider usage and no repaired pillars", async () => {
  const r = await attemptFlowCall(1, attemptDeps(reply(mistralBody({ toolArgs: VALID_ARGS, finish: "tool_calls" }))));
  assert(r.ok);
  assertEquals(r.flowResult.summary, "s");
  assertEquals(r.repairedPillars, []);
  assertEquals(r.usage, { input_tokens: 10, output_tokens: 20 });
});

Deno.test("attemptFlowCall: a reply cut at the ceiling with no tool call is NOT retried (tool-calling path)", async () => {
  const r = await attemptFlowCall(1, attemptDeps(reply(mistralBody({ finish: "length", text: "…thinking…" }))));
  assert(!r.ok);
  assertEquals(r.noRetry, true);
  assertEquals(r.failureLabel, "analysis:max_tokens");
  assertEquals(r.errorResponse.status, 502);
  assert((await errorOf(r.errorResponse)).includes("truncated"));
  assertEquals(r.usage, { input_tokens: 10, output_tokens: 20 });
});

Deno.test("attemptFlowCall: a tool call cut mid-arguments (pillars missing, finish length) is NOT retried either", async () => {
  const r = await attemptFlowCall(1, attemptDeps(reply(mistralBody({ toolArgs: { summary: "s" }, finish: "length" }))));
  assert(!r.ok);
  assertEquals(r.noRetry, true);
  assertEquals(r.failureLabel, "analysis:max_tokens");
});

Deno.test("attemptFlowCall: a complete reply with no tool call, or with invalid pillars, stays on the retry funnel", async () => {
  const noTool = await attemptFlowCall(1, attemptDeps(reply(mistralBody({ finish: "stop", text: "prose instead of a tool call" }))));
  assert(!noTool.ok);
  assertEquals(noTool.noRetry, undefined);
  assert((await errorOf(noTool.errorResponse)).includes("unexpected format"));

  const badPillars = await attemptFlowCall(1, attemptDeps(reply(mistralBody({ toolArgs: { summary: "s" }, finish: "stop" }))));
  assert(!badPillars.ok);
  assertEquals(badPillars.noRetry, undefined);
  assert((await errorOf(badPillars.errorResponse)).includes("could not be completed"));
});

Deno.test("attemptFlowCall: attempt 1 sends baseLlmArgs as-is; attempt 2 rebuilds the messages with the nudge", async () => {
  const seen: LlmArgs[] = [];
  const deps = attemptDeps(reply(mistralBody({ toolArgs: VALID_ARGS, finish: "tool_calls" }), 200, seen));
  await attemptFlowCall(1, deps);
  await attemptFlowCall(2, deps);
  assertEquals(seen.length, 2);
  assert(seen[0] === deps.baseLlmArgs, "attempt 1 passes the resolved args through");
  assertEquals(seen[1].messages.length, 2);
  assertEquals(seen[1].messages[0].content, "SYS");
  assert(String(seen[1].messages[1].content).startsWith("USER"));
  assert(String(seen[1].messages[1].content).includes(NUDGE));
  assertEquals(seen[1].max_tokens, 100);
});

Deno.test("attemptFlowCall: a provider error becomes a 502 with the extracted message, no usage", async () => {
  const r = await attemptFlowCall(1, attemptDeps(reply({ message: "Service Unavailable" }, 503)));
  assert(!r.ok);
  assertEquals(r.errorResponse.status, 502);
  assertEquals(r.usage, {});
  assertEquals(r.noRetry, undefined);
});

Deno.test("attemptFlowCall: Structured Outputs refusal and max_tokens are the deterministic failures (no retry)", async () => {
  const anthropic = { flowModel: "claude-sonnet-4-6", provider: "anthropic" as const, useStructuredOutputs: true };
  const refusal = await attemptFlowCall(1, attemptDeps(
    reply({ stop_reason: "refusal", content: [], usage: { input_tokens: 5, output_tokens: 0 } }),
    anthropic,
  ));
  assert(!refusal.ok);
  assertEquals(refusal.noRetry, true);
  assertEquals(refusal.failureLabel, "analysis:refusal");

  const cut = await attemptFlowCall(1, attemptDeps(
    reply({ stop_reason: "max_tokens", content: [{ type: "text", text: "{\"summary\":" }], usage: { input_tokens: 5, output_tokens: 99 } }),
    anthropic,
  ));
  assert(!cut.ok);
  assertEquals(cut.noRetry, true);
  assertEquals(cut.failureLabel, "analysis:max_tokens");
  assertEquals(cut.usage, { input_tokens: 5, output_tokens: 99 });
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
