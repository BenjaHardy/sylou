// Sylou's migrations, applied to an install's database.
//
// The same files hosted Sylou runs and the database tests replay: in name
// order, one transaction each, each recorded with a checksum so a file that
// changed after it was applied is noticed rather than applied twice.
//
// It runs as `postgres`, never as `supabase_admin`: that role hands every new
// table to the API roles through its own default privileges, which would undo
// the grants the migrations make on purpose (the one difference A0 found
// against the replay CI runs).
import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

export interface MigrationFile {
  version: string;
  checksum: string;
  path: string;
}

export interface RecordedMigration {
  version: string;
  checksum: string;
}

export interface Plan {
  toApply: MigrationFile[];
  problem?: string;
}

/**
 * What to do, given the files in this release and what the database says it
 * has already applied. Pure, so the awkward cases are easy to test.
 */
export function plan(files: MigrationFile[], recorded: RecordedMigration[]): Plan {
  const byVersion = new Map(files.map((file) => [file.version, file]));
  const known = new Map(recorded.map((row) => [row.version, row.checksum]));

  for (const [version, checksum] of known) {
    const file = byVersion.get(version);
    if (!file) {
      return {
        toApply: [],
        problem:
          `the database has a migration this version of Sylou does not know (${version}). ` +
          "It was probably restored from a backup made by a newer release; update Sylou before starting it.",
      };
    }
    if (file.checksum !== checksum) {
      return {
        toApply: [],
        problem: `${version} has changed since it was applied to this database.`,
      };
    }
  }

  const toApply = [...files]
    .sort((a, b) => a.version.localeCompare(b.version))
    .filter((file) => !known.has(file.version));
  return { toApply };
}

export async function checksumOf(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The .sql files of a folder, in name order, each with its checksum. */
export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const files: MigrationFile[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".sql")) continue;
    const path = `${dir}/${entry.name}`;
    files.push({
      version: entry.name.replace(/\.sql$/, ""),
      checksum: await checksumOf(await Deno.readTextFile(path)),
      path,
    });
  }
  return files.sort((a, b) => a.version.localeCompare(b.version));
}

const RECORD_TABLE = `
  create schema if not exists sylou_local;
  create table if not exists sylou_local.migrations (
    version text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  );
`;

/** Sign-in and storage run their own migrations before ours may start. */
async function waitForServices(client: Client, seconds = 60): Promise<void> {
  for (let attempt = 0; attempt < seconds; attempt++) {
    try {
      const auth = await client.queryObject<{ count: bigint }>("select count(*) as count from auth.schema_migrations");
      const storage = await client.queryObject<{ count: bigint }>("select count(*) as count from storage.migrations");
      if (Number(auth.rows[0]?.count ?? 0) > 0 && Number(storage.rows[0]?.count ?? 0) > 0) return;
    } catch {
      // Their tables are not there yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("sign-in and storage did not finish their own migrations in time");
}

export interface MigrateOptions {
  migrationsDir: string;
  /** Overridden by the tests; an install always reads the secret file. */
  connection?: string;
  /**
   * An install waits for sign-in and storage to have migrated first. The
   * tests run against a plain database, which has neither.
   */
  waitForOthers?: boolean;
}

function connectionString(): string {
  const password = Deno.readTextFileSync("/run/secrets/pg_postgres_password").trim();
  return `postgres://postgres:${encodeURIComponent(password)}@db:5432/postgres`;
}

export async function migrate(options: MigrateOptions): Promise<number> {
  const started = Date.now();
  const client = new Client(options.connection ?? connectionString());
  await client.connect();
  try {
    if (options.waitForOthers ?? true) await waitForServices(client);
    await client.queryArray(RECORD_TABLE);

    const files = await readMigrations(options.migrationsDir);
    const recorded = await client.queryObject<RecordedMigration>(
      "select version, checksum from sylou_local.migrations",
    );
    const { toApply, problem } = plan(files, recorded.rows);
    if (problem) {
      console.error(`migrate: ${problem}`);
      return 1;
    }

    for (const file of toApply) {
      const sql = await Deno.readTextFile(file.path);
      try {
        const transaction = client.createTransaction(`sylou_${file.version}`);
        await transaction.begin();
        await transaction.queryArray(sql);
        await transaction.queryArray(
          "insert into sylou_local.migrations (version, checksum) values ($1, $2)",
          [file.version, file.checksum],
        );
        await transaction.commit();
      } catch (error) {
        console.error(`migrate: ${file.version} failed, and nothing of it was kept`);
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
      }
    }

    // The data API keeps its own picture of the schema; this tells it to
    // read the new one.
    await client.queryArray("notify pgrst, 'reload schema'");
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `migrate: ${toApply.length} applied, ${files.length} recorded in all, ${seconds} s`,
    );
    return 0;
  } finally {
    await client.end();
  }
}
