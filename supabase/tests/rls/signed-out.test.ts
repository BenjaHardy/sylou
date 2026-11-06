// Signed out (the anon role every visitor's requests run as): no table or
// view can be read or written, and get_shared_report is the one function
// that can be called. Tables, views and functions are read from the
// catalog, so new ones are covered without editing this file.

import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { assertDenied, assertSucceeded, ident, inTransaction, query } from "./db.ts";

const relations = await query<{ name: string; kind: string; first_column: string }>(`
  SELECT c.relname AS name, c.relkind AS kind, a.attname AS first_column
  FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = 1
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'v', 'm')
  ORDER BY 1`);

const functions = await query<{ name: string; args: string }>(`
  SELECT p.proname AS name, oidvectortypes(p.proargtypes) AS args
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  ORDER BY 1`);

Deno.test("signed out: the catalog lists the tables, the view and the functions", () => {
  assert(relations.some((r) => r.kind === "r"), "no tables found");
  assert(relations.some((r) => r.name === "flow_reports_public"), "flow_reports_public not found");
  assert(functions.some((f) => f.name === "get_shared_report"), "get_shared_report not found");
});

for (const { name, first_column } of relations) {
  Deno.test(`signed out: ${name} cannot be read or written`, () =>
    inTransaction(async (s) => {
      await s.as("anon");
      const t = `public.${ident(name)}`;
      const column = ident(first_column);
      for (
        const sql of [
          `SELECT * FROM ${t} LIMIT 1`,
          `INSERT INTO ${t} DEFAULT VALUES`,
          `UPDATE ${t} SET ${column} = ${column}`,
          `DELETE FROM ${t}`,
        ]
      ) {
        assertDenied(await s.attempt(sql), `${sql}, signed out`);
      }
    }));
}

for (const { name, args } of functions) {
  if (name === "get_shared_report") continue;
  Deno.test(`signed out: ${name}() cannot be called`, () =>
    inTransaction(async (s) => {
      await s.as("anon");
      const nulls = args ? args.split(", ").map((type) => `NULL::${type}`).join(", ") : "";
      assertDenied(await s.attempt(`SELECT public.${ident(name)}(${nulls})`), `${name}(), signed out`);
    }));
}

Deno.test("signed out: get_shared_report can be called, and an unknown link finds nothing", () =>
  inTransaction(async (s) => {
    await s.as("anon");
    assertSucceeded(
      await s.attempt("SELECT * FROM public.get_shared_report($1)", ["not-a-share-token"]),
      0,
      "get_shared_report with an unknown token",
    );
  }));
