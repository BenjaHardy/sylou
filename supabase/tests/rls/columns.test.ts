// Writable columns: where users may change some columns of their own rows
// but not others, the columns user A can actually update are exactly the
// ones the app writes; every other column, the budget and the report's
// evidence among them, is refused by the database. Each column is tried
// with an update that keeps its value.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { A } from "./fixtures.ts";
import { assertSucceeded, ident, inTransaction, type Outcome, query } from "./db.ts";

const WRITABLE: Record<string, string[]> = {
  // useFlowAnalysis: the pre-analysis feedback and the self-assessment.
  flow_reports: ["user_feedback_post", "user_feedback_post_at", "user_feedback_pre", "user_feedback_pre_at"],
  // Settings and the editor's preferences.
  profiles: [
    "default_concise_mode",
    "display_name",
    "flow_nudges_enabled",
    "preferred_chat_model",
    "preferred_chat_reasoning",
    "preferred_flow_model",
    "preferred_language",
  ],
};

function describe(outcome: Outcome): string {
  return outcome.ok ? `${outcome.rowCount} rows` : `${outcome.code}: ${outcome.message}`;
}

Deno.test("only profiles and flow_reports limit users to some of their columns", async () => {
  const tables = await query<{ name: string }>(
    `SELECT relname AS name FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p')
       AND has_any_column_privilege('authenticated', oid, 'UPDATE')
       AND NOT has_table_privilege('authenticated', oid, 'UPDATE')
     ORDER BY 1`,
  );
  assertEquals(tables.map((t) => t.name), Object.keys(WRITABLE).sort());
});

for (const [table, expected] of Object.entries(WRITABLE)) {
  Deno.test(`${table}: user A can change exactly the columns the app writes`, () =>
    inTransaction(async (s) => {
      const columns = await s.rows<{ name: string }>(
        `SELECT attname AS name FROM pg_attribute
         WHERE attrelid = $1::regclass AND attnum > 0 AND NOT attisdropped ORDER BY 1`,
        [`public.${table}`],
      );
      await s.as({ user: A.user });
      const writable: string[] = [];
      for (const { name } of columns) {
        const column = ident(name);
        const outcome = await s.attempt(
          `UPDATE public.${ident(table)} SET ${column} = ${column} WHERE id = $1`,
          [A.rows[table]],
        );
        if (outcome.ok && outcome.rowCount === 1) {
          writable.push(name);
        } else {
          assert(!outcome.ok && outcome.code === "42501", `${table}.${name}: unexpected ${describe(outcome)}`);
        }
      }
      assertEquals(writable, expected);
    }));
}

Deno.test("A's settings and self-assessment are saved", () =>
  inTransaction(async (s) => {
    await s.as({ user: A.user });
    assertSucceeded(
      await s.attempt("UPDATE public.profiles SET display_name = 'Renamed' WHERE id = $1", [A.user]),
      1,
      "saving A's display name",
    );
    assertSucceeded(
      await s.attempt(
        "UPDATE public.flow_reports SET user_feedback_post = $1, user_feedback_post_at = now() WHERE id = $2",
        ['{"rating": 4}', A.rows.flow_reports],
      ),
      1,
      "saving A's self-assessment",
    );
    const [saved] = await s.rows<{ name: string; rating: number }>(
      `SELECT p.display_name AS name, (r.user_feedback_post ->> 'rating')::int AS rating
       FROM public.profiles p, public.flow_reports r WHERE p.id = $1 AND r.id = $2`,
      [A.user, A.rows.flow_reports],
    );
    assertEquals(saved, { name: "Renamed", rating: 4 });
  }));
