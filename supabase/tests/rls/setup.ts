// Builds the database the RLS tests run against: a fresh database with the
// Supabase stand-in, every migration in order, and the rows of the two test
// users. Run by `deno task test:db` before the tests.

import { connect, TEST_DATABASE } from "./db.ts";
import { A, B, seedSql } from "./fixtures.ts";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);
const STAND_IN = new URL("./supabase.sql", import.meta.url);

const server = await connect("postgres");
await server.query(`DROP DATABASE IF EXISTS ${TEST_DATABASE} WITH (FORCE)`);
await server.query(`CREATE DATABASE ${TEST_DATABASE}`);
await server.end();

const files: string[] = [];
for await (const entry of Deno.readDir(MIGRATIONS)) {
  if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
  if (!/^\d{14}_/.test(entry.name)) throw new Error(`Unexpected migration name: ${entry.name}`);
  files.push(entry.name);
}
files.sort();

const db = await connect(TEST_DATABASE);
try {
  // Each file runs in a transaction of its own, as the Supabase CLI applies them.
  const run = async (name: string, sql: string) => {
    try {
      await db.query(`BEGIN;\n${sql}\n;COMMIT;`);
    } catch (error) {
      await db.query("ROLLBACK").catch(() => {});
      throw new Error(`${name} failed: ${(error as Error).message}`, { cause: error });
    }
  };
  await run("supabase.sql", await Deno.readTextFile(STAND_IN));
  for (const name of files) await run(name, await Deno.readTextFile(new URL(name, MIGRATIONS)));
  await run("test users", seedSql(A) + seedSql(B));
} finally {
  await db.end();
}

console.log(`${TEST_DATABASE}: ${files.length} migrations applied, test users A and B created`);
