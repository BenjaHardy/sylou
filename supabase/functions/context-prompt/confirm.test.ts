// Deno unit tests for the CONFIRM endpoint's pending-gate contract.
// Run with: deno test supabase/functions/context-prompt/confirm.test.ts
//
// Pins the CLAUDE.md §4 decision-recording contract: first decision
// wins, replays/flips no-op idempotently, CONFIRM never writes chat or
// summary rows. A red test means that contract changed — checkpoint,
// not test edit. Fakes follow the persist.test.ts pattern.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleConfirm } from "./confirm.ts";

type Call = { client: "user" | "admin"; op: string; table?: string; values?: Record<string, unknown>; eqs?: [string, string][] };

function makeFakes(opts: {
  ownedProject?: boolean;
  gateMatches?: boolean;
  gateError?: unknown;
} = {}) {
  const { ownedProject = true, gateMatches = true, gateError = null } = opts;
  const calls: Call[] = [];

  const user = {
    from: (table: string) => ({
      select: (_cols: string) => ({
        eq: (_col: string, _v: string) => ({
          maybeSingle: () => {
            calls.push({ client: "user", op: "select", table });
            return Promise.resolve({ data: ownedProject ? { id: "proj-1" } : null });
          },
        }),
      }),
    }),
  };

  const admin = {
    from: (table: string) => ({
      update: (values: Record<string, unknown>) => {
        const eqs: [string, string][] = [];
        const chain = {
          eq: (col: string, v: string) => {
            eqs.push([col, v]);
            return chain;
          },
          select: (_cols: string) => ({
            maybeSingle: () => {
              calls.push({ client: "admin", op: "update", table, values, eqs });
              return Promise.resolve({
                data: gateError ? null : gateMatches ? { id: "act-1" } : null,
                error: gateError,
              });
            },
          }),
        };
        return chain;
      },
    }),
  };

  return { calls, user, admin };
}

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function run(body: Record<string, unknown>, fakes: ReturnType<typeof makeFakes>) {
  const res = await handleConfirm({
    body,
    supabase: fakes.user,
    admin: fakes.admin,
    projectId: "proj-1",
    jsonResponse,
  });
  return { status: res.status, body: await res.json() };
}

Deno.test("ownership fails closed: foreign project → 404 and ZERO admin writes", async () => {
  const fakes = makeFakes({ ownedProject: false });
  const r = await run({ confirm: true, action_id: "act-1" }, fakes);
  assertEquals(r.status, 404);
  assert(!fakes.calls.some((c) => c.client === "admin"));
});

Deno.test("missing action_id: already_resolved no-op, nothing written", async () => {
  const fakes = makeFakes();
  const r = await run({ confirm: true }, fakes);
  assertEquals(r.body, { ok: true, inserted_messages: [], already_resolved: true });
  assert(!fakes.calls.some((c) => c.client === "admin"));
});

Deno.test("outcome mapping: reject / modified / accepted", async () => {
  for (const [body, expected] of [
    [{ confirm: false, action_id: "a" }, "rejected"],
    [{ confirm: true, action_id: "a", modified: true }, "modified"],
    [{ confirm: true, action_id: "a" }, "accepted"],
  ] as const) {
    const fakes = makeFakes();
    await run(body as Record<string, unknown>, fakes);
    const update = fakes.calls.find((c) => c.op === "update");
    assertEquals(update?.values, { outcome: expected });
  }
});

Deno.test("the pending-gate predicates: id + project_id + outcome='pending', exactly", async () => {
  const fakes = makeFakes();
  await run({ confirm: true, action_id: "act-9" }, fakes);
  const update = fakes.calls.find((c) => c.op === "update");
  assertEquals(update?.table, "ai_editor_actions");
  assertEquals(update?.eqs, [["id", "act-9"], ["project_id", "proj-1"], ["outcome", "pending"]]);
});

Deno.test("first decision wins: zero-row gate match (replay/flip) → already_resolved, ok", async () => {
  const fakes = makeFakes({ gateMatches: false });
  const r = await run({ confirm: false, action_id: "act-1" }, fakes);
  assertEquals(r.body, { ok: true, inserted_messages: [], already_resolved: true });
});

Deno.test("gate error → 500 'Failed to record decision'", async () => {
  const fakes = makeFakes({ gateError: { code: "boom" } });
  const r = await run({ confirm: true, action_id: "act-1" }, fakes);
  assertEquals(r.status, 500);
  assertEquals(r.body, { error: "Failed to record decision" });
});

Deno.test("success: decision recorded, inserted_messages stays [] (delivery already logged the exchange)", async () => {
  const fakes = makeFakes();
  const r = await run({ confirm: true, action_id: "act-1" }, fakes);
  assertEquals(r.status, 200);
  assertEquals(r.body, { ok: true, inserted_messages: [] });
});
