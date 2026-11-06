// Rules for the whole database, read from the catalog after every migration
// has run: RLS on every table, nothing for the signed-out role, exactly the
// operations the policies cover for the signed-in role, views kept
// read-only, and security-definer functions with a fixed search_path.
// migrations-privileges.test.ts checks the same intent in the migration
// text; this checks what the database ends up with.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { query } from "./db.ts";

const PRIVILEGES = "ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']";

/** Privileges `role` holds on public relations of the given kinds, column grants included. */
async function privileges(role: string, kinds: string[]): Promise<Record<string, string[]>> {
  const rows = await query<{ name: string; privilege: string }>(
    `SELECT c.relname AS name, p.privilege
     FROM pg_class c CROSS JOIN unnest(${PRIVILEGES}) p(privilege)
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = ANY ($2)
       AND (has_table_privilege($1, c.oid, p.privilege)
            OR (p.privilege IN ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES')
                AND has_any_column_privilege($1, c.oid, p.privilege)))
     ORDER BY 1, 2`,
    [role, kinds],
  );
  const held: Record<string, string[]> = {};
  for (const { name, privilege } of rows) (held[name] ??= []).push(privilege);
  return held;
}

async function tables(): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT relname AS name FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') ORDER BY 1`,
  );
  return rows.map((r) => r.name);
}

Deno.test("RLS is enabled on every table", async () => {
  const off = await query(
    `SELECT relname FROM pg_class
     WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') AND NOT relrowsecurity`,
  );
  assertEquals(off, []);
});

Deno.test("the signed-out role holds no privilege on any table or view", async () => {
  assertEquals(await privileges("anon", ["r", "p", "v", "m"]), {});
});

Deno.test("the signed-in role holds exactly the operations its policies cover", async () => {
  const policies = await query<{ name: string; cmd: string }>(
    `SELECT tablename AS name, cmd FROM pg_policies
     WHERE schemaname = 'public' AND roles && ARRAY['authenticated', 'public']::name[]`,
  );
  const expected: Record<string, string[]> = {};
  for (const name of await tables()) expected[name] = [];
  for (const { name, cmd } of policies) {
    for (const op of cmd === "ALL" ? ["SELECT", "INSERT", "UPDATE", "DELETE"] : [cmd]) {
      if (!expected[name].includes(op)) expected[name].push(op);
    }
  }
  for (const ops of Object.values(expected)) ops.sort();
  const held = await privileges("authenticated", ["r", "p"]);
  const actual: Record<string, string[]> = {};
  for (const name of Object.keys(expected)) actual[name] = held[name] ?? [];
  assertEquals(actual, expected);
});

Deno.test("the service role, which the edge functions use, has full access to every table", async () => {
  const held = await privileges("service_role", ["r", "p"]);
  const missing = (await tables()).filter((name) =>
    !["DELETE", "INSERT", "SELECT", "UPDATE"].every((op) => held[name]?.includes(op))
  );
  assertEquals(missing, []);
});

Deno.test("views give the API roles at most read access, and the shared-report view none", async () => {
  for (const role of ["anon", "authenticated"]) {
    const held = await privileges(role, ["v", "m"]);
    const beyondRead = Object.entries(held).filter(([, ops]) => ops.some((op) => op !== "SELECT"));
    assertEquals(beyondRead, [], `${role} holds more than SELECT on a view`);
    assertEquals(held["flow_reports_public"], undefined, `${role} can read flow_reports_public`);
  }
});

Deno.test("every security-definer function pins its search_path", async () => {
  const unpinned = await query(
    `SELECT proname FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace AND prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(proconfig) c WHERE c LIKE 'search_path=%')`,
  );
  assertEquals(unpinned, []);
});

Deno.test("trigger functions cannot be called by the API roles", async () => {
  const callable = await query(
    `SELECT p.proname, r.role FROM pg_proc p
     CROSS JOIN unnest(ARRAY['anon', 'authenticated']) r(role)
     WHERE p.pronamespace = 'public'::regnamespace AND p.prorettype = 'trigger'::regtype
       AND has_function_privilege(r.role, p.oid, 'EXECUTE')`,
  );
  assertEquals(callable, []);
});
