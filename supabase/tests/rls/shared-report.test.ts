// Shared reports: get_shared_report, the one function a signed-out visitor
// may call, shows a report whose owner turned sharing on, found by its exact
// link token, with every report column except the editor summary; the
// feedback and the replay appear only when the owner shares them.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { A, B } from "./fixtures.ts";
import { type Caller, inTransaction, query, type Session } from "./db.ts";

const TOKEN = "share-token-of-a";

interface Share {
  enabled?: boolean;
  visibility?: string;
  feedback?: boolean;
  replay?: boolean;
}

/** As the database owner: shares A's report under TOKEN; it holds feedback,
 * a replay and an editor summary, to be shown or hidden. */
async function shareA(
  s: Session,
  { enabled = true, visibility = "public", feedback = false, replay = false }: Share = {},
): Promise<void> {
  await s.asOwner();
  await s.rows(
    `UPDATE public.flow_reports
     SET share_token = $2, share_enabled = $3, share_visibility = $4,
         share_include_feedback = $5, share_include_replay = $6,
         user_feedback_pre = '{"confidence": 3}', user_feedback_pre_at = now(),
         user_feedback_post = '{"rating": 4}', user_feedback_post_at = now(),
         replay_snapshot = '{"steps": []}', ai_editor_summary = '{"note": "not shared"}'
     WHERE id = $1`,
    [A.rows.flow_reports, TOKEN, enabled, visibility, feedback, replay],
  );
}

/** What get_shared_report returns for `token` to `caller`. */
async function lookUp(s: Session, caller: Caller, token: string | null): Promise<Record<string, unknown>[]> {
  await s.as(caller);
  const outcome = await s.attempt("SELECT * FROM public.get_shared_report($1)", [token]);
  await s.asOwner();
  assert(outcome.ok, `get_shared_report: ${outcome.ok ? "" : `${outcome.code}: ${outcome.message}`}`);
  return outcome.rows;
}

const FEEDBACK = ["user_feedback_pre", "user_feedback_pre_at", "user_feedback_post", "user_feedback_post_at"];

Deno.test("anyone with the link sees the shared report", async (t) => {
  const callers: Array<[string, Caller]> = [
    ["signed out", "anon"],
    ["signed in as B", { user: B.user }],
    ["signed in as A", { user: A.user }],
  ];
  for (const [who, caller] of callers) {
    await t.step(who, () =>
      inTransaction(async (s) => {
        await shareA(s);
        const rows = await lookUp(s, caller, TOKEN);
        assertEquals(rows.map((r) => r.id), [A.rows.flow_reports]);
      }));
  }
});

Deno.test("the link shows every report column except the editor summary", () =>
  inTransaction(async (s) => {
    const columns = await query<{ name: string }>(
      `SELECT attname AS name FROM pg_attribute
       WHERE attrelid = 'public.flow_reports'::regclass AND attnum > 0 AND NOT attisdropped`,
    );
    const expected = columns.map((c) => c.name).filter((name) => name !== "ai_editor_summary").sort();
    await shareA(s, { feedback: true, replay: true });
    const [row] = await lookUp(s, "anon", TOKEN);
    assertEquals(Object.keys(row).sort(), expected);
  }));

Deno.test("the feedback appears only when the owner shares it", async (t) => {
  await t.step("not shared", () =>
    inTransaction(async (s) => {
      await shareA(s, { feedback: false });
      const [row] = await lookUp(s, "anon", TOKEN);
      assertEquals(FEEDBACK.map((column) => row[column]), [null, null, null, null]);
    }));

  await t.step("shared", () =>
    inTransaction(async (s) => {
      await shareA(s, { feedback: true });
      const [row] = await lookUp(s, "anon", TOKEN);
      assertEquals([row.user_feedback_pre, row.user_feedback_post], [{ confidence: 3 }, { rating: 4 }]);
      assert(row.user_feedback_pre_at && row.user_feedback_post_at, "the feedback times are shown");
    }));
});

Deno.test("the replay appears only when the owner shares it", async (t) => {
  for (const replay of [false, true]) {
    await t.step(replay ? "shared" : "not shared", () =>
      inTransaction(async (s) => {
        await shareA(s, { replay });
        const [row] = await lookUp(s, "anon", TOKEN);
        assertEquals(row.replay_snapshot, replay ? { steps: [] } : null);
      }));
  }
});

Deno.test("a link that is switched off, not public or not exact shows nothing", async (t) => {
  const cases: Array<[what: string, share: Share, token: string | null]> = [
    ["sharing switched off", { enabled: false }, TOKEN],
    ["visibility other than public", { visibility: "private" }, TOKEN],
    ["another token", {}, "not-the-token"],
    ["no token", {}, null],
    ["the start of the token", {}, TOKEN.slice(0, -2)],
    ["a wildcard", {}, "%"],
    ["the token in capitals", {}, TOKEN.toUpperCase()],
  ];
  for (const [what, share, token] of cases) {
    await t.step(what, () =>
      inTransaction(async (s) => {
        await shareA(s, share);
        assertEquals(await lookUp(s, "anon", token), []);
      }));
  }
});
