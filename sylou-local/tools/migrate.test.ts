// The migration runner: what it decides to apply, in what order, and the two
// cases where it must refuse rather than guess.
//
// The last test applies Sylou's real migrations to a real database when
// DATABASE_URL is set (CI's Postgres service); without it, it skips.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checksumOf, migrate, plan, readMigrations } from "./migrate.ts";

const file = (version: string, checksum: string) => ({ version, checksum, path: `/migrations/${version}.sql` });

Deno.test("a fresh database gets every migration, in name order", () => {
  const { toApply, problem } = plan(
    [file("20260102", "b"), file("20260101", "a"), file("20260103", "c")],
    [],
  );
  assertEquals(problem, undefined);
  assertEquals(toApply.map((f) => f.version), ["20260101", "20260102", "20260103"]);
});

Deno.test("what the database already has is left alone", () => {
  const { toApply } = plan(
    [file("20260101", "a"), file("20260102", "b")],
    [{ version: "20260101", checksum: "a" }],
  );
  assertEquals(toApply.map((f) => f.version), ["20260102"]);
});

Deno.test("a second run applies nothing", () => {
  const files = [file("20260101", "a"), file("20260102", "b")];
  const { toApply } = plan(files, files.map((f) => ({ version: f.version, checksum: f.checksum })));
  assertEquals(toApply, []);
});

Deno.test("a file that changed after it was applied stops the run", () => {
  const { toApply, problem } = plan(
    [file("20260101", "changed")],
    [{ version: "20260101", checksum: "a" }],
  );
  assertEquals(toApply, []);
  assert(problem?.includes("has changed since it was applied"));
});

Deno.test("a database from a newer release stops the run, rather than being half-migrated", () => {
  const { toApply, problem } = plan(
    [file("20260101", "a")],
    [{ version: "20260101", checksum: "a" }, { version: "20270101", checksum: "z" }],
  );
  assertEquals(toApply, []);
  assert(problem?.includes("does not know"));
  assert(problem?.includes("update Sylou"));
});

Deno.test("a checksum is of the file's contents", async () => {
  assertEquals(
    await checksumOf("select 1;\n"),
    await checksumOf("select 1;\n"),
  );
  assert((await checksumOf("select 1;")) !== (await checksumOf("select 2;")));
  assertEquals((await checksumOf("x")).length, 64);
});

Deno.test("only .sql files are read, and they come back in name order", async () => {
  const dir = await Deno.makeTempDir({ prefix: "sylou-migrations-" });
  try {
    await Deno.writeTextFile(`${dir}/20260102000000_b.sql`, "select 2;");
    await Deno.writeTextFile(`${dir}/20260101000000_a.sql`, "select 1;");
    await Deno.writeTextFile(`${dir}/README.md`, "not a migration");
    const files = await readMigrations(dir);
    assertEquals(files.map((f) => f.version), ["20260101000000_a", "20260102000000_b"]);
    assertEquals(files[0].checksum, await checksumOf("select 1;"));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// A real database, when CI gives us one.
const DATABASE_URL = Deno.env.get("DATABASE_URL");

Deno.test({
  name: "Sylou's own migrations apply to a real database, and a second run applies none",
  ignore: !DATABASE_URL,
  fn: async () => {
    const migrationsDir = new URL("../../supabase/migrations", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const options = { migrationsDir, connection: DATABASE_URL!, waitForOthers: false };

    const printed: string[] = [];
    const log = console.log;
    console.log = (...parts: unknown[]) => printed.push(parts.join(" "));
    try {
      assertEquals(await migrate(options), 0, "the first run failed");
      const applied = Number(printed.join(" ").match(/migrate: (\d+) applied/)?.[1] ?? "0");
      assert(applied > 0, "nothing was applied to an empty database");

      printed.length = 0;
      assertEquals(await migrate(options), 0, "the second run failed");
      assert(printed.join(" ").includes("0 applied"), "the second run applied something again");
    } finally {
      console.log = log;
    }
  },
});
