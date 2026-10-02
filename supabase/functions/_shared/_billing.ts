// Shared budget helpers for the LLM edge functions (P4-1, seam #3).
//
// Extraction-only seam. What moved here, and what deliberately did NOT:
//
// - isOverBudget: was byte-identical in chat/, context-prompt/ and
//   editor-action/ (each copy even carried a comment calling this
//   consolidation "a tracked refactor" — fulfilled). analysis/ checks the
//   budget with its own inline variant and extract-text/ has no precheck
//   at all (a tracked gap): both are BEHAVIOR, not duplication, so both
//   stay exactly as they are.
// - getBudgetedProfile: the uniform lazy-reset + profile-fetch sequence
//   from the same three functions, verbatim (same RPC, same selected
//   columns). Callers keep their own guard responses (404/403) — this
//   helper only fetches. analysis/ selects different columns and keeps
//   its local variant.
// - The per-function billing tails (increment_tokens_used calls, the
//   token_usage audit inserts) are NOT unified here: their shapes
//   genuinely differ per function (chat bills RPC-only; the others also
//   insert token_usage rows at different points). Unifying them needs a
//   parametrized design, not a move — deferred to the file-split phase,
//   deliberately.
//
// A NULL monthly_token_budget means "no limit" (operator hasn't set one).

export interface BudgetProfile {
  monthly_token_budget: number | null;
  tokens_used_this_period: number;
  preferred_chat_model: string | null;
  /** jsonb per-model reasoning choice, raw; resolveReasoning in
   *  _thinking.ts validates it. Absent from pre-20261001130000 rows. */
  preferred_chat_reasoning?: unknown;
}

export function isOverBudget(profile: {
  monthly_token_budget: number | null;
  tokens_used_this_period: number;
}): boolean {
  return (
    profile.monthly_token_budget !== null &&
    profile.tokens_used_this_period >= profile.monthly_token_budget
  );
}

// Minimal structural view of the supabase client (the concrete client's
// generic instance type does not cross module boundaries cleanly); callers
// pass their existing user-context client unchanged.
type BudgetClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => {
        single: () => PromiseLike<{ data: BudgetProfile | null; error: unknown }>;
      };
    };
  };
};

/** Lazy monthly budget-window reset + budget-profile fetch — the uniform
 *  pre-check sequence from chat/context-prompt/editor-action, verbatim.
 *  Callers keep their own 404/403 guards on the returned values. */
export async function getBudgetedProfile(
  client: unknown,
  userId: string,
): Promise<{ profile: BudgetProfile | null; profileErr: unknown }> {
  const c = client as BudgetClient;
  // Best-effort monthly budget-window reset (lazy; no-op if already current).
  await c.rpc("reset_tokens_if_stale", { user_uuid: userId });
  const { data, error } = await c
    .from("profiles")
    .select("tokens_used_this_period, monthly_token_budget, preferred_chat_model, preferred_chat_reasoning")
    .eq("id", userId)
    .single();
  return { profile: data ?? null, profileErr: error };
}
