// Database functions: which API role may call each one (read from the
// catalog, so a new function needs an entry here), that signed-in users are
// refused the ones they may not call, and what the ownership helpers behind
// the policies answer.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { A, B } from "./fixtures.ts";
import { ident, inTransaction, query } from "./db.ts";

/** Who may call each function in public: signed out (anon) and signed in. */
const CALLABLE: Record<string, { anon: boolean; authenticated: boolean }> = {
  enforce_pre_feedback_once: { anon: false, authenticated: false },
  get_shared_report: { anon: true, authenticated: true },
  handle_new_project: { anon: false, authenticated: false },
  handle_new_user: { anon: false, authenticated: false },
  increment_tokens_used: { anon: false, authenticated: true },
  owns_project: { anon: false, authenticated: true },
  owns_thread: { anon: false, authenticated: true },
  record_activity: { anon: false, authenticated: true },
  reset_tokens_if_stale: { anon: false, authenticated: true },
};

const functions = await query<{ name: string; args: string; anon: boolean; authenticated: boolean }>(
  `SELECT p.proname AS name, oidvectortypes(p.proargtypes) AS args,
          has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated
   FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   ORDER BY 1`,
);

Deno.test("each function can be called by exactly the API roles listed", () => {
  const actual = Object.fromEntries(
    functions.map((f) => [f.name, { anon: f.anon, authenticated: f.authenticated }]),
  );
  assertEquals(actual, CALLABLE);
});

for (const { name, args } of functions) {
  if (CALLABLE[name]?.authenticated !== false) continue;
  Deno.test(`signed in: ${name}() cannot be called`, () =>
    inTransaction(async (s) => {
      await s.as({ user: A.user });
      const nulls = args ? args.split(", ").map((type) => `NULL::${type}`).join(", ") : "";
      const outcome = await s.attempt(`SELECT public.${ident(name)}(${nulls})`);
      assert(
        !outcome.ok && outcome.message.startsWith("permission denied for function"),
        `${name}(): ${outcome.ok ? "it ran" : `${outcome.code}: ${outcome.message}`}`,
      );
    }));
}

Deno.test("owns_project and owns_thread are true for the caller's own rows only", async (t) => {
  const answers = `SELECT public.owns_project($1) AS own_project, public.owns_project($2) AS other_project,
                          public.owns_project($3) AS unknown_project, public.owns_thread($4) AS own_thread,
                          public.owns_thread($5) AS other_thread, public.owns_thread($3) AS unknown_thread`;
  const params = () => [A.project, B.project, crypto.randomUUID(), A.thread, B.thread];

  await t.step("signed in as A", () =>
    inTransaction(async (s) => {
      await s.as({ user: A.user });
      assertEquals((await s.rows(answers, params()))[0], {
        own_project: true,
        other_project: false,
        unknown_project: false,
        own_thread: true,
        other_thread: false,
        unknown_thread: false,
      });
    }));

  await t.step("signed in without a user id", () =>
    inTransaction(async (s) => {
      await s.as({ user: null });
      const row = (await s.rows(answers, params()))[0];
      assertEquals(Object.values(row), [false, false, false, false, false, false]);
    }));
});
