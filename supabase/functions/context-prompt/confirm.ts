// context-prompt/confirm.ts — the CONFIRM endpoint (P4-1 Phase D split;
// branch body moved verbatim from index.ts).
//
// CONTRACT (CLAUDE.md §4 / TRANSPARENCY.md §5.1, pinned by
// confirm.test.ts): CONFIRM records ONLY the decision. The exchange
// itself (prompt, summary delta, proposal) was already logged at
// delivery in the main path; nothing is written to the chat or the
// summary log here. The pending-gate makes the first decision win —
// replays, accept↔reject flips and concurrent double-submits match zero
// rows and no-op idempotently.
//
// Clients and the caller's jsonResponse closure are injected (the
// persist.ts pattern): responses stay byte-identical to the pre-split
// branch, and the tests need fakes only — no env stubbing. This module
// must never import index.ts (importing it executes Deno.serve).
//
// ORDERING INVARIANT (caller-side): the handleConfirm call sits exactly
// where the branch always was — AFTER the budget 403, model-allowlist
// 400 and provider-key 500 gates, BEFORE main-path field validation.
// CONFIRM requests deliberately inherit those three rejections.

type Row = Record<string, unknown>;

// Minimal structural views of the supabase clients (persist.ts
// precedent — the concrete client's generic instance type does not
// cross module boundaries cleanly).
type OwnershipClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => {
        maybeSingle: () => PromiseLike<{ data: { id: string } | null }>;
      };
    };
  };
};

type PendingGateChain = {
  eq: (col: string, v: string) => PendingGateChain;
  select: (cols: string) => {
    maybeSingle: () => PromiseLike<{ data: { id: string } | null; error: unknown }>;
  };
};

type GateClient = {
  from: (table: string) => {
    update: (values: Row) => PendingGateChain;
  };
};

export async function handleConfirm(args: {
  /** The parsed request body — destructured verbatim inside. */
  body: Record<string, unknown>;
  /** RLS-scoped user client — the ownership read. */
  supabase: unknown;
  /** Service-role client — the pending-gate outcome transition. */
  admin: unknown;
  projectId: string;
  /** The caller's response closure, so responses stay byte-identical. */
  jsonResponse: (body: Record<string, unknown>, status?: number) => Response;
}): Promise<Response> {
  const { supabase, projectId: project_id, jsonResponse } = args;
  const userClient = supabase as OwnershipClient;
  const adminClient = args.admin as GateClient;
  const { confirm, action_id, modified } = args.body;

  // --- Ownership gate: CONFIRM returns before the main-path projects
  // check and uses the RLS-bypassing service-role client, so it must
  // verify ownership manually. Read via the RLS-scoped `supabase` client —
  // a row comes back only if the caller owns this project. maybeSingle()
  // keeps "not owned" a clean null (fail-closed) rather than a PGRST116.
  const { data: confirmProject } = await userClient
    .from("projects")
    .select("id, tutor_mode")
    .eq("id", project_id)
    .maybeSingle();
  if (!confirmProject) {
    return jsonResponse({ error: "Project not found or not owned by user" }, 404);
  }

  // --- Atomic pending-gate: only the FIRST decision for an action row
  // transitions it out of 'pending'. Replays, accept↔reject flips and
  // concurrent double-submits match zero rows here and no-op idempotently.
  // CONFIRM records ONLY the decision — the exchange itself (prompt,
  // summary delta, proposal) was already logged at delivery in the main
  // path (TRANSPARENCY.md §5.1), so nothing is written to the chat or the
  // summary log here.
  if (!action_id || typeof action_id !== "string") {
    // No ledger row to transition (the Propose-time insert failed).
    return jsonResponse({ ok: true, inserted_messages: [], already_resolved: true });
  }
  const outcome = !confirm ? "rejected" : modified ? "modified" : "accepted";
  const { data: transitioned, error: gateErr } = await adminClient
    .from("ai_editor_actions")
    .update({ outcome })
    .eq("id", action_id)
    .eq("project_id", project_id)
    .eq("outcome", "pending")
    .select("id")
    .maybeSingle();
  if (gateErr) {
    console.error("CONFIRM pending-gate update failed:", JSON.stringify(gateErr));
    return jsonResponse({ error: "Failed to record decision" }, 500);
  }
  if (!transitioned) {
    // Unknown id, not owned, or already decided — nothing written.
    return jsonResponse({ ok: true, inserted_messages: [], already_resolved: true });
  }

  // Decision recorded. inserted_messages stays in the response shape for
  // older clients (always empty — delivery already logged the exchange).
  return jsonResponse({ ok: true, inserted_messages: [] });
}
