// Activity time is recorded by the server: record_activity adds the time
// since the last count by the database's clock, at most 30 seconds per
// heartbeat, on the caller's own projects only, and users can read
// project_stats but not write it. now() stays fixed within a transaction, so
// each check sets the moment last counted relative to it, then calls the
// function as user A.

import { assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { A, B } from "./fixtures.ts";
import {
  assertDenied,
  assertSucceeded,
  type Caller,
  inTransaction,
  type Outcome,
  query,
  type Session,
} from "./db.ts";

interface Stats {
  active: number;
  writing: number;
  prompts: number;
  /** last_activity_at minus now(), in seconds. */
  countedTo: number | null;
  firstActivityAt: string | null;
}

async function stats(s: Session): Promise<Stats> {
  const [row] = await s.rows<Stats>(
    `SELECT total_active_time_seconds::int AS active,
            total_writing_time_seconds::int AS writing,
            (chat_prompt_count_normal + chat_prompt_count_tutor)::int AS prompts,
            extract(epoch FROM last_activity_at - now())::float8 AS "countedTo",
            first_activity_at::text AS "firstActivityAt"
     FROM public.project_stats WHERE project_id = $1`,
    [A.project],
  );
  return row;
}

/** As the database owner: A's time was last counted `seconds` before now() (negative: after). */
async function countedAgo(s: Session, seconds: number): Promise<void> {
  await s.rows(
    `UPDATE public.project_stats SET last_activity_at = now() - make_interval(secs => $1::float8)
     WHERE project_id = $2`,
    [seconds, A.project],
  );
}

/** Calls record_activity `times` times in one statement, then acts as the owner again. */
async function record(
  s: Session,
  { caller = { user: A.user }, project = A.project, writing = false, times = 1 }: {
    caller?: Caller;
    project?: string;
    writing?: boolean;
    times?: number;
  } = {},
): Promise<Outcome> {
  await s.as(caller);
  const outcome = await s.attempt(
    "SELECT count(public.record_activity($1::uuid, $2::boolean)) FROM generate_series(1, $3::int)",
    [project, writing, times],
  );
  await s.asOwner();
  return outcome;
}

/** Records with `options` and returns what changed: seconds added, and where the count now stands. */
async function added(s: Session, options: Parameters<typeof record>[1] = {}) {
  const before = await stats(s);
  assertSucceeded(await record(s, options), 1, "record_activity");
  const after = await stats(s);
  return {
    active: after.active - before.active,
    writing: after.writing - before.writing,
    countedTo: after.countedTo,
  };
}

Deno.test("record_activity adds time by the database's clock", async (t) => {
  await t.step("adds the whole seconds since the last count", () =>
    inTransaction(async (s) => {
      await countedAgo(s, 10);
      assertEquals(await added(s), { active: 10, writing: 0, countedTo: 0 });
    }));

  await t.step("adds at most 30 seconds per heartbeat", () =>
    inTransaction(async (s) => {
      await countedAgo(s, 45);
      assertEquals(await added(s), { active: 30, writing: 0, countedTo: -15 });
    }));

  await t.step("carries fractions of a second over to the next heartbeat", () =>
    inTransaction(async (s) => {
      await countedAgo(s, 25.7);
      const { active, countedTo } = await added(s);
      assertEquals(active, 25);
      assertAlmostEquals(countedTo!, -0.7, 1e-6);
    }));

  await t.step("after a pause of a minute or more, adds 30 seconds and counts on from now", () =>
    inTransaction(async (s) => {
      await countedAgo(s, 60);
      assertEquals(await added(s), { active: 30, writing: 0, countedTo: 0 });
      await countedAgo(s, 2 * 3600);
      assertEquals(await added(s), { active: 30, writing: 0, countedTo: 0 });
    }));

  await t.step("a burst of heartbeats adds the elapsed time once", () =>
    inTransaction(async (s) => {
      await countedAgo(s, 10);
      assertEquals(await added(s, { times: 100 }), { active: 10, writing: 0, countedTo: 0 });
    }));

  await t.step("a burst after a pause adds 30 seconds, not the pause", () =>
    inTransaction(async (s) => {
      await countedAgo(s, 2 * 3600);
      assertEquals(await added(s, { times: 100 }), { active: 30, writing: 0, countedTo: 0 });
    }));

  await t.step("before the first heartbeat, counts from the row's creation", () =>
    inTransaction(async (s) => {
      await s.rows(
        `UPDATE public.project_stats SET last_activity_at = NULL, created_at = now() - interval '5 seconds'
         WHERE project_id = $1`,
        [A.project],
      );
      assertEquals(await added(s), { active: 5, writing: 0, countedTo: 0 });
    }));

  await t.step("a moment slightly ahead of the clock adds nothing and stays", () =>
    inTransaction(async (s) => {
      await countedAgo(s, -5);
      assertEquals(await added(s), { active: 0, writing: 0, countedTo: 5 });
    }));

  await t.step("a moment more than a minute ahead restarts from now", () =>
    inTransaction(async (s) => {
      await countedAgo(s, -2 * 3600);
      assertEquals(await added(s), { active: 0, writing: 0, countedTo: 0 });
    }));

  await t.step("writing time gets the same seconds when the app reports writing", () =>
    inTransaction(async (s) => {
      await countedAgo(s, 12);
      assertEquals(await added(s, { writing: true }), { active: 12, writing: 12, countedTo: 0 });
    }));

  await t.step("sets the first activity once and leaves the prompt counts alone", () =>
    inTransaction(async (s) => {
      await s.rows(
        `UPDATE public.project_stats
         SET first_activity_at = NULL, chat_prompt_count_normal = 2, chat_prompt_count_tutor = 1
         WHERE project_id = $1`,
        [A.project],
      );
      await countedAgo(s, 10);
      await added(s);
      const [{ now }] = await s.rows<{ now: string }>("SELECT now()::text AS now");
      const first = await stats(s);
      assertEquals([first.firstActivityAt, first.prompts], [now, 3]);

      await s.rows(
        `UPDATE public.project_stats SET first_activity_at = now() - interval '1 day'
         WHERE project_id = $1`,
        [A.project],
      );
      const earlier = (await stats(s)).firstActivityAt;
      await countedAgo(s, 10);
      await added(s);
      assertEquals((await stats(s)).firstActivityAt, earlier);
    }));
});

Deno.test("record_activity works only on the caller's own projects", async (t) => {
  await t.step("A cannot record activity on B's project", () =>
    inTransaction(async (s) => {
      const before = await s.snapshot("project_stats", B.rows.project_stats);
      assertDenied(await record(s, { project: B.project }), "record_activity on B's project");
      assertEquals(await s.snapshot("project_stats", B.rows.project_stats), before);
    }));

  for (const caller of ["anon", "service_role"] as const) {
    await t.step(`${caller} cannot call it`, () =>
      inTransaction(async (s) => {
        assertDenied(await record(s, { caller }), `record_activity as ${caller}`);
      }));
  }

  await t.step("only the signed-in role may execute it", async () => {
    const roles = await query<{ role: string; allowed: boolean }>(
      `SELECT r.role, has_function_privilege(r.role, 'public.record_activity(uuid, boolean)', 'EXECUTE') AS allowed
       FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r(role) ORDER BY 1`,
    );
    assertEquals(roles, [
      { role: "anon", allowed: false },
      { role: "authenticated", allowed: true },
      { role: "service_role", allowed: false },
    ]);
  });
});

Deno.test("users can read their project_stats but not write them", async (t) => {
  await t.step("A reads its own row", () =>
    inTransaction(async (s) => {
      await s.as({ user: A.user });
      assertEquals(await s.count("SELECT 1 FROM public.project_stats WHERE project_id = $1", [A.project]), 1);
    }));

  const writes: Array<[what: string, sql: string]> = [
    ["change its totals", "UPDATE public.project_stats SET total_active_time_seconds = 999999 WHERE project_id = $1"],
    ["move the moment last counted", "UPDATE public.project_stats SET last_activity_at = now() - interval '1 day' WHERE project_id = $1"],
    ["add a row", "INSERT INTO public.project_stats (project_id) VALUES ($1)"],
    ["delete its row", "DELETE FROM public.project_stats WHERE project_id = $1"],
  ];
  for (const [what, sql] of writes) {
    await t.step(`A cannot ${what}`, () =>
      inTransaction(async (s) => {
        const before = await s.snapshot("project_stats", A.rows.project_stats);
        await s.as({ user: A.user });
        assertDenied(await s.attempt(sql, [A.project]), `${what} on A's own project_stats`);
        await s.asOwner();
        assertEquals(await s.snapshot("project_stats", A.rows.project_stats), before);
      }));
  }
});
