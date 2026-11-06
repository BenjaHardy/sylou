// Cross-user isolation: signed in as user A, nothing in user B's projects,
// chat threads or account can be read, added to, changed, deleted, or
// received from A, in any table. Also the tables and operations Sylou keeps
// out of users' hands even for their own rows (CLAUDE.md §4), refused here
// the way a direct Data API call would be.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { A, B, type User } from "./fixtures.ts";
import { assertBlocked, assertDenied, ident, inTransaction, query, type Session } from "./db.ts";

type Scope = "project" | "thread" | "user" | "profile";
type Write = "insert" | "update" | "delete";

// jsonb values are given as JSON text.
interface TableCase {
  /** What a row belongs to: a project, a chat thread, or a user's account. */
  scope: Scope;
  /** A row owned by `u`, for the insert attempts. */
  row: (u: User) => Record<string, unknown>;
  /** A column and a new value, for the update attempts. */
  change: [column: string, value: unknown];
  /** Writes refused even on the user's own rows. */
  locked?: Write[];
}

const report = (u: User) => ({
  project_id: u.project,
  ai_summary: "Summary",
  ai_find: "{}",
  ai_lead: "{}",
  ai_organize: "{}",
  ai_write: "{}",
  model_used: "test-model",
});

const TABLES: Record<string, TableCase> = {
  ai_editor_actions: {
    scope: "project",
    row: (u) => ({ project_id: u.project, action_type: "rewrite", outcome: "accepted" }),
    change: ["outcome", "rejected"],
    locked: ["insert", "update", "delete"],
  },
  chat_bookmarks: {
    scope: "project",
    row: (u) => ({ project_id: u.project, thread_id: u.thread, message_id: u.message }),
    change: ["annotation", "Changed"],
  },
  chat_messages: {
    scope: "thread",
    row: (u) => ({ thread_id: u.thread, role: "user", content: "Added" }),
    change: ["content", "Changed"],
    locked: ["insert", "update", "delete"],
  },
  chat_thread_summaries: {
    scope: "thread",
    row: (u) => ({ thread_id: u.thread, summary_text: "Added", covers_through: new Date() }),
    change: ["summary_text", "Changed"],
    locked: ["insert", "update", "delete"],
  },
  chat_threads: {
    scope: "project",
    row: (u) => ({ project_id: u.project, name: "Added" }),
    change: ["name", "Changed"],
    locked: ["delete"],
  },
  flow_reports: {
    scope: "project",
    row: report,
    change: ["user_feedback_post", '{"comment": "Changed"}'],
    locked: ["insert", "delete"],
  },
  imported_documents: {
    scope: "project",
    row: (u) => ({ project_id: u.project, file_name: "added.txt", file_path: `${u.user}/added.txt` }),
    change: ["is_favourite", true],
  },
  post_its: {
    scope: "project",
    row: (u) => ({ project_id: u.project, content: "Added" }),
    change: ["content", "Changed"],
  },
  profiles: {
    scope: "profile",
    row: (u) => ({ id: u.user, email: u.email }),
    change: ["display_name", "Changed"],
    locked: ["insert", "delete"],
  },
  project_creative_data: {
    scope: "project",
    row: (u) => ({ project_id: u.project, tool_type: "timeline" }),
    change: ["data", '{"changed": true}'],
  },
  project_stats: {
    scope: "project",
    row: (u) => ({ project_id: u.project }),
    change: ["total_active_time_seconds", 1],
    locked: ["delete"],
  },
  projects: {
    scope: "user",
    row: (u) => ({ user_id: u.user, name: "Added" }),
    change: ["name", "Changed"],
  },
  provenance_events: {
    scope: "project",
    row: (u) => ({ project_id: u.project }),
    change: ["segment_map", '[{"from": 0, "to": 1, "source": "typed"}]'],
  },
  token_usage: {
    scope: "user",
    row: (u) => ({ user_id: u.user, function_name: "chat", model_used: "test-model" }),
    change: ["input_tokens", 1],
    locked: ["update", "delete"],
  },
  writing_content: {
    scope: "project",
    row: (u) => ({ project_id: u.project, content: "Added" }),
    change: ["content", "Changed"],
  },
  writing_summary_log: {
    scope: "project",
    row: (u) => ({ project_id: u.project, summary_text: "Added" }),
    change: ["summary_text", "Changed"],
    locked: ["insert", "update", "delete"],
  },
  writing_versions: {
    scope: "project",
    row: (u) => ({ project_id: u.project, content: "Added" }),
    change: ["content", "Changed"],
    locked: ["update", "delete"],
  },
};

const OWNER_COLUMN: Record<Scope, string> = {
  project: "project_id",
  thread: "thread_id",
  user: "user_id",
  profile: "id",
};

function ownerOf(scope: Scope, u: User): string {
  return scope === "project" ? u.project : scope === "thread" ? u.thread : u.user;
}

/** The rows a user owns, as the database owner counts them. */
const OWNED_BY: Record<Scope, string> = {
  project: "project_id IN (SELECT id FROM public.projects WHERE user_id = $1)",
  thread: `thread_id IN (SELECT t.id FROM public.chat_threads t
    JOIN public.projects p ON p.id = t.project_id WHERE p.user_id = $1)`,
  user: "user_id = $1",
  profile: "id = $1",
};

/** A's attempts at B's row with `sql` (an UPDATE or DELETE without WHERE).
 * Aimed at the row, which exists, the statement is refused or reaches
 * nothing. Sent without a WHERE clause, as a Data API call without a filter
 * would be, it leaves the UPDATE or DELETE policy alone to pick the rows (a
 * WHERE clause adds the SELECT policy's check), and B's row must stay out of
 * reach there too. The row is unchanged afterwards. */
async function assertUntouched(
  s: Session,
  table: string,
  id: string,
  sql: string,
  params: unknown[],
  what: string,
): Promise<void> {
  const before = await s.snapshot(table, id);
  assert(before, `${what}: fixture row ${id} is missing`);
  await s.as({ user: A.user });
  assertBlocked(await s.attempt(`${sql} WHERE id = $${params.length + 1}`, [...params, id]), what);
  await s.attempt(sql, params);
  await s.asOwner();
  assertEquals(await s.snapshot(table, id), before, `${what}: the row changed`);
}

for (const [table, spec] of Object.entries(TABLES)) {
  const t = `public.${ident(table)}`;
  const owner = OWNER_COLUMN[spec.scope];

  Deno.test(`${table}: user A cannot reach user B's rows`, async (step) => {
    await step.step("A sees its own rows and none of B's", () =>
      inTransaction(async (s) => {
        const ownedByA = await s.count(`SELECT 1 FROM ${t} WHERE ${OWNED_BY[spec.scope]}`, [A.user]);
        const ownedByB = await s.count(`SELECT 1 FROM ${t} WHERE ${OWNED_BY[spec.scope]}`, [B.user]);
        assert(ownedByA > 0 && ownedByB > 0, "both users need rows in the table");
        await s.as({ user: A.user });
        assertEquals(await s.count(`SELECT 1 FROM ${t}`), ownedByA);
        assertEquals(await s.count(`SELECT 1 FROM ${t} WHERE id = $1`, [B.rows[table]]), 0);
      }));

    await step.step("A cannot add a row to B's data", () =>
      inTransaction(async (s) => {
        await s.as({ user: A.user });
        assertDenied(await s.insert(table, spec.row(B)), `insert into ${table} for B`);
      }));

    await step.step("A cannot change B's row", () =>
      inTransaction((s) =>
        assertUntouched(
          s,
          table,
          B.rows[table],
          `UPDATE ${t} SET ${ident(spec.change[0])} = $1`,
          [spec.change[1]],
          `update of B's ${table} row`,
        )
      ));

    await step.step("A cannot take B's row into its own data", () =>
      inTransaction((s) =>
        assertUntouched(
          s,
          table,
          B.rows[table],
          `UPDATE ${t} SET ${ident(owner)} = $1`,
          [ownerOf(spec.scope, A)],
          `taking B's ${table} row`,
        )
      ));

    await step.step("A cannot delete B's row", () =>
      inTransaction((s) =>
        assertUntouched(s, table, B.rows[table], `DELETE FROM ${t}`, [], `delete of B's ${table} row`)
      ));

    // No WHERE clause, for the same reason as in assertUntouched: the new
    // rows then face the policy's WITH CHECK alone.
    await step.step("A cannot hand its rows over to B", () =>
      inTransaction(async (s) => {
        await s.as({ user: A.user });
        assertDenied(
          await s.attempt(`UPDATE ${t} SET ${ident(owner)} = $1`, [ownerOf(spec.scope, B)]),
          `moving A's ${table} rows to B`,
        );
      }));

    for (const write of spec.locked ?? []) {
      await step.step(`A cannot ${write} its own rows`, () =>
        inTransaction(async (s) => {
          const id = A.rows[table];
          const before = await s.snapshot(table, id);
          await s.as({ user: A.user });
          const what = `${write} on A's own ${table}`;
          if (write === "insert") {
            assertDenied(await s.insert(table, spec.row(A)), what);
          } else if (write === "update") {
            const sql = `UPDATE ${t} SET ${ident(spec.change[0])} = $1 WHERE id = $2`;
            assertBlocked(await s.attempt(sql, [spec.change[1], id]), what);
          } else {
            assertBlocked(await s.attempt(`DELETE FROM ${t} WHERE id = $1`, [id]), what);
          }
          await s.asOwner();
          assertEquals(await s.snapshot(table, id), before, `${what}: the row changed`);
        }));
    }
  });
}

Deno.test("every table in public has an isolation case", async () => {
  const tables = await query<{ name: string }>(
    `SELECT relname AS name FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') ORDER BY 1`,
  );
  assertEquals(tables.map((r) => r.name), Object.keys(TABLES).sort());
});
