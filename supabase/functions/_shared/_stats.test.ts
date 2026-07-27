// Deno unit tests for the project_stats helpers.
// Run with: deno test supabase/functions/_shared/_stats.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { incrementPromptCount } from "./_stats.ts";

type Call =
  | { kind: "select"; cols: string; projectId: string }
  | { kind: "update"; values: Record<string, unknown>; projectId: string };

function fakeClient(row: Record<string, number> | null, updateError: unknown = null) {
  const calls: Call[] = [];
  const client = {
    from: (_table: string) => ({
      select: (cols: string) => ({
        eq: (_col: string, v: string) => ({
          single: () => {
            calls.push({ kind: "select", cols, projectId: v });
            return Promise.resolve({ data: row ? { ...row } : null });
          },
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: (_col: string, v: string) => {
          calls.push({ kind: "update", values, projectId: v });
          return Promise.resolve({ error: updateError });
        },
      }),
    }),
  };
  return { client, calls };
}

Deno.test("incrementPromptCount: normal mode bumps chat_prompt_count_normal by one", async () => {
  const { client, calls } = fakeClient({ chat_prompt_count_normal: 3 });
  await incrementPromptCount(client, "proj-1", false, "[test]");
  assertEquals(calls, [
    { kind: "select", cols: "chat_prompt_count_normal", projectId: "proj-1" },
    { kind: "update", values: { chat_prompt_count_normal: 4 }, projectId: "proj-1" },
  ]);
});

Deno.test("incrementPromptCount: tutor mode targets chat_prompt_count_tutor", async () => {
  const { client, calls } = fakeClient({ chat_prompt_count_tutor: 7 });
  await incrementPromptCount(client, "proj-2", true, "[test]");
  assertEquals(calls[1], {
    kind: "update",
    values: { chat_prompt_count_tutor: 8 },
    projectId: "proj-2",
  });
});

Deno.test("incrementPromptCount: a missing/undefined count starts from zero", async () => {
  const { client, calls } = fakeClient({});
  await incrementPromptCount(client, "proj-3", false, "[test]");
  assertEquals(calls[1], {
    kind: "update",
    values: { chat_prompt_count_normal: 1 },
    projectId: "proj-3",
  });
});

Deno.test("incrementPromptCount: no stats row means no update attempt", async () => {
  const { client, calls } = fakeClient(null);
  await incrementPromptCount(client, "proj-4", false, "[test]");
  assertEquals(calls.length, 1);
  assertEquals(calls[0].kind, "select");
});

Deno.test("incrementPromptCount: an update error is swallowed (logged, never thrown)", async () => {
  const { client, calls } = fakeClient({ chat_prompt_count_normal: 1 }, { code: "boom" });
  await incrementPromptCount(client, "proj-5", false, "[test]");
  assert(calls.some((c) => c.kind === "update"));
});
