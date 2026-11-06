// Connection helpers for the database tests. Each check runs in its own
// transaction, acting as one of the Data API roles the way Supabase does
// for a request, and is rolled back, so the rows setup.ts created never
// change.

import pg from "npm:pg@8.23.1";
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

/** The server setup.ts builds the test database on. */
export const SERVER_URL = Deno.env.get("DATABASE_URL") ??
  "postgres://postgres:postgres@127.0.0.1:54329/postgres";
export const TEST_DATABASE = "sylou_rls";

export function databaseUrl(database: string): string {
  const url = new URL(SERVER_URL);
  url.pathname = `/${database}`;
  return url.href;
}

// The part of pg's client these tests use (pg ships without types).
export interface PgClient {
  connect(): Promise<void>;
  query(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end(): Promise<void>;
}

export function connect(database: string): Promise<PgClient> {
  const client = new pg.Client({ connectionString: databaseUrl(database) }) as PgClient;
  return client.connect().then(() => client);
}

/** A signed-in user, a signed-out visitor, or the edge functions. */
export type Caller = { user: string } | "anon" | "service_role";

/** How one statement ended: the rows it returned or touched, or the error. */
export type Outcome =
  | { ok: true; rowCount: number; rows: Record<string, unknown>[] }
  | { ok: false; code: string; message: string };

export function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export class Session {
  #client: PgClient;

  constructor(client: PgClient) {
    this.#client = client;
  }

  /** Acts as `caller` for the rest of the transaction, as the Data API does. */
  async as(caller: Caller): Promise<void> {
    const [role, claims] = typeof caller === "object"
      ? ["authenticated", { sub: caller.user, role: "authenticated" }]
      : [caller, { role: caller }];
    await this.#client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(claims),
    ]);
    await this.#client.query(`SET LOCAL ROLE ${ident(role)}`);
  }

  /** Back to the database owner, who sees every row. */
  async asOwner(): Promise<void> {
    await this.#client.query("RESET ROLE");
    await this.#client.query("SELECT set_config('request.jwt.claims', '', true)");
  }

  async rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.#client.query(sql, params)).rows as T[];
  }

  async count(sql: string, params: unknown[] = []): Promise<number> {
    const [row] = await this.rows<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) q`, params);
    return row.n;
  }

  /** Runs one statement; an error is returned instead of ending the transaction. */
  async attempt(sql: string, params: unknown[] = []): Promise<Outcome> {
    await this.#client.query("SAVEPOINT attempt");
    try {
      const result = await this.#client.query(sql, params);
      await this.#client.query("RELEASE SAVEPOINT attempt");
      return { ok: true, rowCount: result.rowCount ?? 0, rows: result.rows };
    } catch (error) {
      await this.#client.query("ROLLBACK TO SAVEPOINT attempt");
      const { code, message } = error as { code?: unknown; message?: unknown };
      if (typeof code !== "string") throw error;
      return { ok: false, code, message: String(message) };
    }
  }

  insert(table: string, row: Record<string, unknown>): Promise<Outcome> {
    const columns = Object.keys(row);
    const values = columns.map((_, i) => `$${i + 1}`);
    return this.attempt(
      `INSERT INTO public.${ident(table)} (${columns.map(ident).join(", ")}) VALUES (${values.join(", ")})`,
      Object.values(row),
    );
  }

  /** The row as JSON text, read as the database owner, to compare before and after. */
  async snapshot(table: string, id: string): Promise<string | undefined> {
    const [row] = await this.rows<{ row: string }>(
      `SELECT row_to_json(t)::text AS row FROM public.${ident(table)} t WHERE id = $1`,
      [id],
    );
    return row?.row;
  }
}

/** Runs `fn` in one transaction on the test database, then rolls it back. */
export async function inTransaction(fn: (s: Session) => Promise<void>): Promise<void> {
  const client = await connect(TEST_DATABASE);
  try {
    await client.query("BEGIN");
    await fn(new Session(client));
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

/** Reads the catalog (or any query) as the database owner. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  let rows: T[] = [];
  await inTransaction(async (s) => {
    rows = await s.rows<T>(sql, params);
  });
  return rows;
}

function describe(outcome: Outcome): string {
  return outcome.ok
    ? `succeeded (${outcome.rowCount} row${outcome.rowCount === 1 ? "" : "s"})`
    : `failed with ${outcome.code}: ${outcome.message}`;
}

/** Refused outright: no privilege, or a row-level policy rejected the row. */
export function assertDenied(outcome: Outcome, what: string): void {
  assert(!outcome.ok && outcome.code === "42501", `${what}: expected 42501, ${describe(outcome)}`);
}

/** Refused outright, or the row-level policy hid every row from the statement. */
export function assertBlocked(outcome: Outcome, what: string): void {
  assert(
    (outcome.ok && outcome.rowCount === 0) || (!outcome.ok && outcome.code === "42501"),
    `${what}: expected no rows touched or 42501, ${describe(outcome)}`,
  );
}

export function assertSucceeded(outcome: Outcome, rowCount: number, what: string): void {
  assert(outcome.ok, `${what}: ${describe(outcome)}`);
  assertEquals(outcome.rowCount, rowCount, `${what}: ${describe(outcome)}`);
}
