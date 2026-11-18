// The commands that touch an install's data: what a backup leaves out, what
// a restore refuses to do, and what rotating the secrets changes.
//
// The two shell files run inside the database's own image, where pg_dump and
// psql live, so nothing here can run them. What this pins is the list they
// carry: the tables a backup must not take, which is the difference between
// a restore that works and one that hands an old session back.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";

const PACKAGE_DIR = fromFileUrl(new URL("../", import.meta.url));
const read = (...parts: string[]) => Deno.readTextFileSync(join(PACKAGE_DIR, ...parts));
const backup = read("db", "backup.sh");
const restore = read("db", "restore.sh");
const rotate = read("db", "rotate.sh");
const compose = read("compose.yaml");

/** The rows a new install writes for itself, or must not be given. */
const LEFT_OUT = [
  // The services' own migrations: the new install runs its own, and
  // storage's are one-way since Supabase 0.8.3.
  "auth.schema_migrations",
  "storage.migrations",
  "storage.buckets",
  "storage.buckets_analytics",
  "storage.buckets_vectors",
  "storage.vector_indexes",
  // The sessions. A0 restored a backup and an old refresh token still
  // worked, because a session here is a row, not a signed token.
  "auth.refresh_tokens",
  "auth.sessions",
  "auth.mfa_amr_claims",
  "auth.flow_state",
  "auth.one_time_tokens",
];

Deno.test("a backup leaves out every table a restore must not carry", () => {
  for (const table of LEFT_OUT) {
    assertStringIncludes(backup, `--exclude-table '${table}'`);
  }
});

Deno.test("a backup takes the three schemas Sylou's own data lives in", () => {
  for (const schema of ["public", "auth", "storage"]) {
    assertStringIncludes(backup, `--schema ${schema}`);
  }
  // Data only: the schema itself comes from the migrations, which the new
  // install applies before anything is loaded into it.
  assertStringIncludes(backup, "--data-only");
});

Deno.test("a backup never holds this install's secrets, and says so", () => {
  assert(!/\/run\/secrets\/[a-z_]*\b.*>/.test(backup.replace(/PGPASSWORD=.*/g, "")), "a secret is written into the backup");
  assertStringIncludes(backup, "the secrets are NOT in here");
  // The only secret it reads is the one it needs to talk to the database.
  const secretsRead = [...backup.matchAll(/\/run\/secrets\/([a-z_]+)/g)].map((match) => match[1]);
  assertEquals([...new Set(secretsRead)], ["pg_postgres_password"]);
});

Deno.test("a backup records what it made, so a restore can tell", () => {
  for (const line of ["made:", "release:", "schema_version:", "data.sql sha256:", "files.tar sha256:"]) {
    assertStringIncludes(backup, line);
  }
});

Deno.test("a restore stops when the folder is not the one the manifest describes", () => {
  assertStringIncludes(restore, "sha256sum");
  assertStringIncludes(restore, "Nothing was changed.");
  // And stops at the first error rather than loading half a dump.
  assertStringIncludes(restore, "ON_ERROR_STOP=1");
});

Deno.test("a restore keeps all of the dump or none of it", () => {
  // One transaction for the whole dump: without it, a stop part-way kept every
  // table loaded before it, while the command said the install was as it was.
  const load = restore.indexOf("psql -X -q -v ON_ERROR_STOP=1 --single-transaction -f /backup/data.sql");
  assert(load > 0, "the dump is not loaded in one transaction");
  // Nothing that can fail comes after it: the documents' files go back
  // before, and the data API's reload is part of the same transaction.
  assert(restore.indexOf("tar -C /storage -xf /backup/files.tar") < load, "the files go back after the data");
  assert(restore.indexOf("notify pgrst") > load, "the reload is not part of the load");
  assertEquals(restore.lastIndexOf("psql "), load, "something asks the database after the load");
});

Deno.test("a restore goes only into an install that has no accounts yet", () => {
  // Restored onto `setup you@example.com`, a backup collided on the account's
  // address part-way through the dump.
  const count = restore.indexOf("select count(*) from auth.users");
  assert(count > 0, "the accounts are not counted");
  assert(count < restore.indexOf("tar -C /storage -xf"), "the accounts are counted after something changed");
  assertStringIncludes(restore, "already has accounts");
  assertStringIncludes(restore, "setup without an email");
});

Deno.test("a restore runs as postgres, the role allowed to switch triggers off", () => {
  assertStringIncludes(restore, "PGUSER=postgres");
  assertStringIncludes(backup, "SET session_replication_role = replica;");
  assert(!restore.includes("supabase_admin"), "restoring as supabase_admin would re-grant every new table");
});

Deno.test("both run in the database's own image, on the inside, with one secret", () => {
  for (const service of ["dump", "load"]) {
    const block = compose.slice(compose.indexOf(`  ${service}:`));
    const body = block.slice(0, block.indexOf("\n  load:") >= 0 ? block.indexOf("\n  load:") : 2000);
    assertStringIncludes(body, "supabase/postgres:17.6.1.136@sha256:");
    assertStringIncludes(body, "secrets: [pg_postgres_password]");
    assertStringIncludes(body, "networks: [backend]");
    assertStringIncludes(body, "profiles: [tools]");
  }
  // A backup only reads the documents; a restore writes them.
  assertStringIncludes(compose, "- storage-data:/storage:ro");
  assertStringIncludes(compose, "- storage-data:/storage\n");
});

Deno.test("a restore can put the documents back where storage keeps them", () => {
  // The storage service writes its folders as root. Restored as `postgres`,
  // the documents could not go back in: "can't make dir ./stub/stub/:
  // Permission denied" (found 2026-11-17, on a copy of storage's own folders).
  const body = compose.slice(compose.indexOf("  load:")).slice(0, 900);
  assertStringIncludes(body, 'user: "0:0"');
  // Root here owns those folders and nothing more: every capability is
  // dropped, as for every other container.
  assertStringIncludes(compose.slice(compose.indexOf("x-one-shot:")).slice(0, 300), "cap_drop: [ALL]");
  assertStringIncludes(body, "<<: *one-shot");
});

Deno.test("rotating the secrets changes every role's password, and nothing else", () => {
  for (const role of ["supabase_admin", "postgres", "authenticator", "supabase_auth_admin", "supabase_storage_admin"]) {
    assertStringIncludes(rotate, `ALTER USER ${role} WITH PASSWORD`);
  }
  // It signs in as the role the image makes a superuser, with the password
  // the install has now, and reads the new ones from the folder the command
  // mounted. `postgres` is not a superuser here - the database answers
  // "supabase_admin is a reserved role" when it tries, which is how this was
  // found: by running it.
  assertStringIncludes(rotate, "PGUSER=supabase_admin");
  assertStringIncludes(rotate, "/run/secrets/pg_supabase_admin_password");
  assertStringIncludes(rotate, "/new/pg_postgres_password");
  // Each new password is read from its own file by psql, so none of them is
  // ever an argument, a line of SQL, or anything a log could keep.
  for (const name of ["pg_supabase_admin_password", "pg_authenticator_password", "pg_auth_admin_password", "pg_storage_admin_password"]) {
    assertStringIncludes(rotate, `cat /new/${name}`);
  }
  // Nothing is dropped or emptied: the writing is untouched.
  for (const dangerous of ["DROP ", "DELETE ", "TRUNCATE "]) {
    assert(!rotate.toUpperCase().includes(dangerous), `rotate.sh holds ${dangerous.trim()}`);
  }
});

Deno.test("rotating refuses to start when the new secrets are not all there", () => {
  assertStringIncludes(rotate, "is missing or empty; nothing was changed");
  assertStringIncludes(rotate, "set -euo pipefail");
});

Deno.test("the rotate one-shot runs where the others do, with the old password only", () => {
  const body = compose.slice(compose.indexOf("  rotate:")).slice(0, 1200);
  assertStringIncludes(body, "supabase/postgres:17.6.1.136@sha256:");
  // The superuser's password, because only a superuser may change that role,
  // and the install's current `postgres` password beside it.
  assertStringIncludes(body, "secrets: [pg_supabase_admin_password, pg_postgres_password]");
  assertStringIncludes(body, "profiles: [tools]");
  assertStringIncludes(body, "networks: [backend]");
});
