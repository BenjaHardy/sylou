// The token budget: users cannot set their own budget, usage or period
// directly, the usage grows only through increment_tokens_used and by the
// exact amount, and reset_tokens_if_stale zeroes it only once its month has
// passed. Both functions act on the caller's own row only; the edge
// functions' service role may act on any user's.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { A, B } from "./fixtures.ts";
import { assertDenied, assertSucceeded, type Caller, inTransaction, type Outcome, type Session } from "./db.ts";

interface Budget {
  budget: number | null;
  used: number;
  period: string;
}

/** A user's budget columns, read as the database owner. */
async function budgetOf(s: Session, user: string): Promise<Budget> {
  await s.asOwner();
  const [row] = await s.rows<Budget>(
    `SELECT monthly_token_budget::int AS budget, tokens_used_this_period::int AS used,
            token_period_start::text AS period
     FROM public.profiles WHERE id = $1`,
    [user],
  );
  return row;
}

/** As the database owner: sets a user's usage and the month it counts for. */
async function setUsage(s: Session, user: string, used: number, monthsAgo: number): Promise<void> {
  await s.asOwner();
  await s.rows(
    `UPDATE public.profiles
     SET tokens_used_this_period = $2,
         token_period_start = date_trunc('month', now()) - make_interval(months => $3)
     WHERE id = $1`,
    [user, used, monthsAgo],
  );
}

async function call(s: Session, caller: Caller, sql: string, params: unknown[]): Promise<Outcome> {
  await s.as(caller);
  return await s.attempt(sql, params);
}

const increment = "SELECT public.increment_tokens_used($1, $2)";
const reset = "SELECT public.reset_tokens_if_stale($1)";

/** Refused by the function's own check, with its message. */
function assertRefused(outcome: Outcome, message: string, what: string): void {
  assert(
    !outcome.ok && outcome.code === "P0001" && outcome.message.startsWith(message),
    `${what}: expected "${message}…", ${outcome.ok ? "it succeeded" : `${outcome.code}: ${outcome.message}`}`,
  );
}

Deno.test("users cannot set their budget, usage or period directly", async (t) => {
  const writes: Array<[column: string, value: string]> = [
    ["monthly_token_budget", "100000000"],
    ["tokens_used_this_period", "0"],
    ["token_period_start", "now() + interval '1 year'"],
  ];
  for (const [column, value] of writes) {
    await t.step(column, () =>
      inTransaction(async (s) => {
        await setUsage(s, A.user, 500, 0);
        const before = await budgetOf(s, A.user);
        await s.as({ user: A.user });
        assertDenied(
          await s.attempt(`UPDATE public.profiles SET ${column} = ${value} WHERE id = $1`, [A.user]),
          `setting A's ${column}`,
        );
        assertEquals(await budgetOf(s, A.user), before);
      }));
  }
});

Deno.test("increment_tokens_used adds exactly the amount, to the caller's own usage", async (t) => {
  await t.step("adds the amount to A's usage", () =>
    inTransaction(async (s) => {
      await setUsage(s, A.user, 500, 0);
      assertSucceeded(await call(s, { user: A.user }, increment, [A.user, 120]), 1, "adding 120");
      assertSucceeded(await call(s, { user: A.user }, increment, [A.user, 0]), 1, "adding 0");
      assertEquals((await budgetOf(s, A.user)).used, 620);
    }));

  await t.step("refuses a negative amount", () =>
    inTransaction(async (s) => {
      await setUsage(s, A.user, 500, 0);
      assertRefused(await call(s, { user: A.user }, increment, [A.user, -50]), "Amount must be non-negative", "adding -50");
      assertEquals((await budgetOf(s, A.user)).used, 500);
    }));

  await t.step("refuses to add to B's usage", () =>
    inTransaction(async (s) => {
      await setUsage(s, B.user, 500, 0);
      assertRefused(await call(s, { user: A.user }, increment, [B.user, 10]), "Forbidden", "A adding to B's usage");
      assertEquals((await budgetOf(s, B.user)).used, 500);
    }));

  await t.step("refuses a signed-in token without a user id", () =>
    inTransaction(async (s) => {
      await setUsage(s, A.user, 500, 0);
      assertRefused(await call(s, { user: null }, increment, [A.user, 10]), "Forbidden", "adding without a user id");
      assertEquals((await budgetOf(s, A.user)).used, 500);
    }));

  await t.step("lets the service role add to any user's usage", () =>
    inTransaction(async (s) => {
      await setUsage(s, B.user, 500, 0);
      assertSucceeded(await call(s, "service_role", increment, [B.user, 10]), 1, "the service role adding 10");
      assertEquals((await budgetOf(s, B.user)).used, 510);
    }));
});

Deno.test("reset_tokens_if_stale zeroes the usage only once its month has passed", async (t) => {
  await t.step("leaves the current month's usage alone", () =>
    inTransaction(async (s) => {
      await setUsage(s, A.user, 500, 0);
      const before = await budgetOf(s, A.user);
      assertSucceeded(await call(s, { user: A.user }, reset, [A.user]), 1, "reset in the current month");
      assertEquals(await budgetOf(s, A.user), before);
    }));

  await t.step("starts a new period once the month has passed", () =>
    inTransaction(async (s) => {
      await setUsage(s, A.user, 500, 1);
      assertSucceeded(await call(s, { user: A.user }, reset, [A.user]), 1, "reset after the month");
      const [{ month }] = await s.rows<{ month: string }>("SELECT date_trunc('month', now())::text AS month");
      const after = await budgetOf(s, A.user);
      assertEquals([after.used, after.period], [0, month]);
    }));

  await t.step("refuses to reset B's usage", () =>
    inTransaction(async (s) => {
      await setUsage(s, B.user, 500, 1);
      const before = await budgetOf(s, B.user);
      assertRefused(await call(s, { user: A.user }, reset, [B.user]), "Forbidden", "A resetting B's usage");
      assertEquals(await budgetOf(s, B.user), before);
    }));

  await t.step("refuses a signed-in token without a user id", () =>
    inTransaction(async (s) => {
      await setUsage(s, A.user, 500, 1);
      const before = await budgetOf(s, A.user);
      assertRefused(await call(s, { user: null }, reset, [A.user]), "Forbidden", "resetting without a user id");
      assertEquals(await budgetOf(s, A.user), before);
    }));
});
