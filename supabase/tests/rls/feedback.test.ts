// Feedback on FLOW reports: the pre-analysis feedback can be given once, on
// a project's first report only, and never changed or cleared afterwards;
// the self-assessment stays editable on every report.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { A, B } from "./fixtures.ts";
import { assertBlocked, assertSucceeded, inTransaction, type Outcome, type Session } from "./db.ts";

const PRE = '{"confidence": 3}';
const setPre = "UPDATE public.flow_reports SET user_feedback_pre = $1, user_feedback_pre_at = now() WHERE id = $2";
const setPost = "UPDATE public.flow_reports SET user_feedback_post = $1, user_feedback_post_at = now() WHERE id = $2";

/** As the database owner: a second report on A's project, a day after the first. */
async function laterReport(s: Session): Promise<string> {
  await s.asOwner();
  const [{ id }] = await s.rows<{ id: string }>(
    `INSERT INTO public.flow_reports (project_id, ai_summary, ai_find, ai_lead, ai_organize, ai_write, model_used, created_at)
     SELECT project_id, 'Later report', '{}', '{}', '{}', '{}', 'test-model', created_at + interval '1 day'
     FROM public.flow_reports WHERE id = $1
     RETURNING id`,
    [A.rows.flow_reports],
  );
  return id;
}

/** Refused by the feedback rule, with its message. */
function assertRefused(outcome: Outcome, message: string, what: string): void {
  assert(
    !outcome.ok && outcome.code === "42501" && outcome.message.includes(message),
    `${what}: expected the "${message}" refusal, ${outcome.ok ? "it succeeded" : `${outcome.code}: ${outcome.message}`}`,
  );
}

async function preOf(s: Session, report: string): Promise<string | null> {
  await s.asOwner();
  const [row] = await s.rows<{ pre: string | null }>(
    "SELECT user_feedback_pre::text AS pre FROM public.flow_reports WHERE id = $1",
    [report],
  );
  return row.pre;
}

Deno.test("the pre-analysis feedback is given once, on the project's first report", async (t) => {
  await t.step("A gives it, then can neither change nor clear it", () =>
    inTransaction(async (s) => {
      const first = A.rows.flow_reports;
      await s.as({ user: A.user });
      assertSucceeded(await s.attempt(setPre, [PRE, first]), 1, "giving the pre-analysis feedback");
      const attempts: Array<[what: string, sql: string, params: unknown[]]> = [
        ["changing it", setPre, ['{"confidence": 5}', first]],
        ["clearing it", "UPDATE public.flow_reports SET user_feedback_pre = NULL, user_feedback_pre_at = NULL WHERE id = $1", [first]],
        ["moving its time", "UPDATE public.flow_reports SET user_feedback_pre_at = now() - interval '1 day' WHERE id = $1", [first]],
      ];
      for (const [what, sql, params] of attempts) {
        assertRefused(await s.attempt(sql, params), "only once", what);
      }
      assertEquals(await preOf(s, first), PRE);
    }));

  await t.step("setting either of its two columns counts as giving it", () =>
    inTransaction(async (s) => {
      const first = A.rows.flow_reports;
      await s.as({ user: A.user });
      assertSucceeded(
        await s.attempt("UPDATE public.flow_reports SET user_feedback_pre_at = now() WHERE id = $1", [first]),
        1,
        "setting the time alone",
      );
      assertRefused(await s.attempt(setPre, [PRE, first]), "only once", "adding the feedback afterwards");
      assertEquals(await preOf(s, first), null);
    }));

  await t.step("it cannot be given on a later report", () =>
    inTransaction(async (s) => {
      const later = await laterReport(s);
      await s.as({ user: A.user });
      assertRefused(await s.attempt(setPre, [PRE, later]), "first FLOW report", "feedback on the later report");
      assertEquals(await preOf(s, later), null);
    }));

  await t.step("A cannot give it on B's report", () =>
    inTransaction(async (s) => {
      await s.as({ user: A.user });
      assertBlocked(await s.attempt(setPre, [PRE, B.rows.flow_reports]), "feedback on B's report");
      assertEquals(await preOf(s, B.rows.flow_reports), null);
    }));
});

Deno.test("the self-assessment stays editable on every report", () =>
  inTransaction(async (s) => {
    const first = A.rows.flow_reports;
    const later = await laterReport(s);
    await s.as({ user: A.user });
    assertSucceeded(await s.attempt(setPre, [PRE, first]), 1, "giving the pre-analysis feedback");
    for (const [report, rating] of [[first, 2], [first, 4], [later, 3], [later, 5]] as const) {
      assertSucceeded(await s.attempt(setPost, [`{"rating": ${rating}}`, report]), 1, `rating ${rating}`);
    }
    await s.asOwner();
    const ratings = await s.rows<{ rating: number }>(
      `SELECT (user_feedback_post ->> 'rating')::int AS rating FROM public.flow_reports
       WHERE id = ANY ($1::uuid[]) ORDER BY created_at`,
      [[first, later]],
    );
    assertEquals(ratings.map((r) => r.rating), [4, 5]);
  }));
