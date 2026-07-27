// Shared project_stats helpers.
//
// Counting policy (maintainer ruling, 2026-07-27): standard chat prompts
// and context-prompt Ask/Propose exchanges count toward
// chat_prompt_count_normal/_tutor; inline editor actions and CONFIRM
// decisions do not. project_stats is display/export-only — the FLOW
// model never reads it (analysis only snapshots it into
// flow_reports.metrics_snapshot), so counting is not an assessment
// signal.
//
// incrementPromptCount mirrors chat's awaited tail form verbatim
// (select-then-update; non-atomic read-modify-write is the pre-existing
// pattern at single-user-per-project scale; failures are logged and
// never fatal to the exchange). chat/'s three local variants are
// deliberately NOT switched to this helper yet — that dedupe belongs to
// the Phase D chat split.

// Minimal structural view of the supabase client (the concrete client's
// generic instance type does not cross module boundaries cleanly) —
// same approach as _billing.ts.
type StatsClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, v: string) => {
        single: () => PromiseLike<{ data: Record<string, number> | null }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (col: string, v: string) => PromiseLike<{ error: unknown }>;
    };
  };
};

export async function incrementPromptCount(
  client: unknown,
  projectId: string,
  tutorMode: boolean,
  logTag: string,
): Promise<void> {
  const c = client as StatsClient;
  const promptColumn = tutorMode ? "chat_prompt_count_tutor" : "chat_prompt_count_normal";
  const { data: cs } = await c
    .from("project_stats")
    .select(promptColumn)
    .eq("project_id", projectId)
    .single();
  if (cs) {
    const cnt = cs[promptColumn] || 0;
    const { error: statsErr } = await c
      .from("project_stats")
      .update({ [promptColumn]: cnt + 1 })
      .eq("project_id", projectId);
    if (statsErr) {
      console.error(`${logTag} project_stats update failed:`, JSON.stringify(statsErr));
    } else {
      console.log(`${logTag} prompt count incremented for`, projectId);
    }
  }
}
