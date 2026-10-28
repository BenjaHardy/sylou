// Privilege lint for supabase/migrations: replays every migration in order
// and checks that the grant layer and the RLS layer agree for every public
// table. Exists because Supabase no longer grants Data API access to new
// tables automatically (2026-10-30 for every project; earlier for new
// ones), so a migration that creates a table without grants leaves it
// unreachable on a fresh install — see 20260925120000_data-api-grants-
// mirror-rls.sql. The model below starts from ZERO privileges, i.e. a
// post-change project, so what passes here is what works there.
//
// Rules pinned:
//   1. every public table has RLS enabled;
//   2. service_role holds full DML on every table (edge functions);
//   3. authenticated holds exactly the operations that have a policy —
//      no more (a policy-less operation would only be RLS-denied, and the
//      lockdowns deserve both layers), no less (a policy without a grant
//      is "permission denied" in production);
//   4. anon holds nothing on base tables (its reads go through the granted
//      view and RPC);
//   5. no user role holds TRUNCATE, REFERENCES or TRIGGER;
//   6. profiles and flow_reports keep their column-level-only UPDATE (the
//      budget freeze; the feedback columns of a report);
//   7. on a view, a user role holds at most SELECT — an owner-executed view
//      bypasses RLS on its base table and is writable through PostgREST
//      when it is auto-updatable (the flow_reports_public finding of
//      2026-09-24, see 20260925130000).
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// vitest runs from the repository root (where vitest.config.ts lives); under
// the jsdom environment import.meta.url is not a file: URL, so resolve from
// the working directory instead.
const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");
const DML = ["SELECT", "INSERT", "UPDATE", "DELETE"] as const;
const ALL_PRIVS = [...DML, "TRUNCATE", "REFERENCES", "TRIGGER"] as const;
const ROLES = ["anon", "authenticated", "service_role"] as const;
type Role = (typeof ROLES)[number];
type Priv = (typeof ALL_PRIVS)[number];

interface TableState {
  kind: "table" | "view";
  rls: boolean;
  policies: Map<string, string>; // policy name -> command (SELECT/INSERT/UPDATE/DELETE/ALL)
  grants: Record<Role, Map<Priv, "table" | "column">>;
}

function replayMigrations(): Map<string, TableState> {
  const tables = new Map<string, TableState>();
  const table = (raw: string, kind: "table" | "view" = "table"): TableState => {
    const name = raw.replace(/^public\./i, "").toLowerCase();
    let s = tables.get(name);
    if (!s) {
      s = { kind, rls: false, policies: new Map(), grants: { anon: new Map(), authenticated: new Map(), service_role: new Map() } };
      tables.set(name, s);
    }
    return s;
  };

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8")
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ");
    for (const stmt of sql.split(";")) {
      const s = stmt.trim();
      let m: RegExpMatchArray | null;
      if ((m = s.match(/^CREATE TABLE (?:IF NOT EXISTS )?(public\.[a-z_]+)/i))) table(m[1]);
      else if ((m = s.match(/^CREATE (?:OR REPLACE )?VIEW (public\.[a-z_]+)/i))) table(m[1], "view");
      else if ((m = s.match(/^ALTER TABLE (?:ONLY )?(public\.[a-z_]+) ENABLE ROW LEVEL SECURITY/i))) table(m[1]).rls = true;
      else if ((m = s.match(/^DROP POLICY (?:IF EXISTS )?"([^"]+)" ON (public\.[a-z_]+)/i))) table(m[2]).policies.delete(m[1]);
      else if ((m = s.match(/^CREATE POLICY "([^"]+)" ON (public\.[a-z_]+)(?: AS \w+)? FOR (\w+)/i))) {
        table(m[2]).policies.set(m[1], m[3].toUpperCase());
      } else if ((m = s.match(/^(GRANT|REVOKE) (.+?) ON (?:TABLE )?(public\.[a-z_]+) (?:TO|FROM) (.+)$/i))) {
        const [, verb, privText, target, roleText] = m;
        const name = target.replace(/^public\./i, "").toLowerCase();
        if (!tables.has(name)) continue; // not a created table or view (functions never match this shape)
        const state = tables.get(name)!;
        const roles = roleText.split(",").map((r) => r.trim().toLowerCase()).filter((r): r is Role => (ROLES as readonly string[]).includes(r));
        const privs: Array<{ priv: Priv; column: boolean }> = [];
        for (const pm of privText.toUpperCase().matchAll(/\b(SELECT|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)\b(\s*\([^)]*\))?/g)) {
          if (pm[1] === "ALL") ALL_PRIVS.forEach((p) => privs.push({ priv: p, column: false }));
          else privs.push({ priv: pm[1] as Priv, column: Boolean(pm[2]) });
        }
        for (const role of roles) {
          for (const { priv, column } of privs) {
            if (verb.toUpperCase() === "GRANT") state.grants[role].set(priv, column ? "column" : "table");
            else state.grants[role].delete(priv); // revoking a table privilege drops its column privileges too
          }
        }
      }
    }
  }
  return tables;
}

const relations = replayMigrations();
const tables = new Map([...relations].filter(([, s]) => s.kind === "table"));
const views = new Map([...relations].filter(([, s]) => s.kind === "view"));
const names = [...tables.keys()].sort();
const policyOps = (s: TableState): string[] => {
  const ops = new Set<string>();
  for (const cmd of s.policies.values()) (cmd === "ALL" ? [...DML] : [cmd]).forEach((c) => ops.add(c));
  return [...ops].sort();
};
const dmlGrants = (s: TableState, role: Role): string[] => [...s.grants[role].keys()].filter((p) => (DML as readonly string[]).includes(p)).sort();

describe("migrations: grants mirror RLS on every public table", () => {
  it("replays the migrations and finds the known tables", () => {
    expect(names.length).toBeGreaterThanOrEqual(17);
    for (const t of ["profiles", "projects", "chat_messages", "flow_reports", "provenance_events"]) expect(names).toContain(t);
  });

  it("every table has RLS enabled", () => {
    for (const [name, s] of tables) expect(s.rls, name).toBe(true);
  });

  it("service_role holds full DML on every table", () => {
    for (const [name, s] of tables) expect(dmlGrants(s, "service_role"), name).toEqual([...DML].sort());
  });

  it("authenticated holds exactly the operations that have a policy", () => {
    for (const [name, s] of tables) expect(dmlGrants(s, "authenticated"), name).toEqual(policyOps(s));
  });

  it("anon holds nothing on base tables", () => {
    for (const [name, s] of tables) expect([...s.grants.anon.keys()], name).toEqual([]);
  });

  it("no user role holds TRUNCATE, REFERENCES or TRIGGER", () => {
    for (const [name, s] of tables) {
      for (const role of ["anon", "authenticated"] as const) {
        for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER"] as const) expect(s.grants[role].has(priv), `${name}/${role}/${priv}`).toBe(false);
      }
    }
  });

  it("the deliberate lockdowns are visible at the grant layer", () => {
    for (const name of ["chat_messages", "writing_summary_log", "ai_editor_actions", "chat_thread_summaries"]) {
      expect(dmlGrants(tables.get(name)!, "authenticated"), name).toEqual(["SELECT"]);
    }
    expect(dmlGrants(tables.get("chat_threads")!, "authenticated")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(dmlGrants(tables.get("flow_reports")!, "authenticated")).toEqual(["SELECT", "UPDATE"]);
    expect(dmlGrants(tables.get("writing_versions")!, "authenticated")).toEqual(["INSERT", "SELECT"]);
    // UPDATE is column-level only: the budget freeze on profiles, the
    // feedback columns on flow_reports.
    for (const name of ["profiles", "flow_reports"]) {
      expect(tables.get(name)!.grants.authenticated.get("UPDATE"), name).toBe("column");
    }
  });

  it("on a view, a user role holds at most SELECT", () => {
    expect([...views.keys()]).toContain("flow_reports_public");
    for (const [name, s] of views) {
      for (const role of ["anon", "authenticated"] as const) {
        const held = [...s.grants[role].keys()].filter((p) => p !== "SELECT");
        expect(held, `${name}/${role}`).toEqual([]);
      }
    }
    // Shared reports are read only through the get_shared_report RPC:
    // the user roles hold nothing on the view, not even SELECT.
    for (const role of ["anon", "authenticated"] as const) {
      expect([...views.get("flow_reports_public")!.grants[role].keys()], role).toEqual([]);
    }
  });
});
