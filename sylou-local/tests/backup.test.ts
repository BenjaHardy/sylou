// What a backup leaves out, and what a restore refuses to do.
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
