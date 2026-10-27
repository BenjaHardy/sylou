// share-report/index.test.ts — the share-report handler over HTTP: CORS, the
// token check, the report → project → user ownership check, the toggle
// action and share-link creation (token and FLOW-XXXXXXXX report id).
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assertEquals, assertMatch, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeEnv,
  importHandler,
  post,
  preflight,
  TEST_ORIGIN,
  writes,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const NO_ROW = { data: null, error: { code: "PGRST116", message: "no rows" } };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// 32 characters: A–Z without I and O, then 2–9.
const REPORT_ID = /^FLOW-[A-HJ-NP-Z2-9]{8}$/;

interface World {
  /** false = no such report. */
  report?: boolean;
  /** The user_id on the report's project. */
  owner?: string;
  /** How many freshly drawn report ids are already taken. */
  takenIds?: number;
  /** The flow_reports update fails. */
  failUpdate?: boolean;
}

/** Report r-1 in project p-1 ("My essay"), owned by u-1 unless told otherwise. */
function world(w: World) {
  let idLookups = 0;
  return (call: DbCall): DbResult | undefined => {
    const first = call.steps[0]?.[0];
    const last = call.steps.at(-1)?.[0];
    switch (`${call.client} ${call.target}`) {
      case "admin flow_reports":
        if (first === "update") return { data: null, error: w.failUpdate ? { message: "update denied" } : null };
        if (last === "maybeSingle") {
          idLookups++;
          return idLookups <= (w.takenIds ?? 0) ? { data: { id: "r-other" }, error: null } : { data: null, error: null };
        }
        return w.report === false ? NO_ROW : {
          data: { id: "r-1", project_id: "p-1", share_token: null, certificate_id: null, share_enabled: false },
          error: null,
        };
      case "admin projects":
        return { data: { id: "p-1", user_id: w.owner ?? "u-1", name: "My essay" }, error: null };
    }
    return undefined;
  };
}

async function send(req: Request, opts: { world?: World; claims?: Record<string, unknown> | null } = {}) {
  const backend = fakeBackend({
    claims: opts.claims === undefined ? { sub: "u-1" } : opts.claims,
    respond: world(opts.world ?? {}),
  });
  const res = await handler(req, { env: fakeEnv(), createClient: backend.createClient });
  return { res, backend };
}

const clientsBuilt = (backend: ReturnType<typeof fakeBackend>) => backend.created.map((c) => c.client);

/** The report ids the handler checked for uniqueness, in order. */
const idsLookedUp = (calls: DbCall[]) =>
  calls.flatMap((c) => c.steps.filter(([step, column]) => step === "eq" && column === "certificate_id").map(([, , id]) => id));

// ── CORS and the token check ─────────────────────────────────────────────

Deno.test("preflight from the allowed origin: CORS headers, and no client is built", async () => {
  const { res, backend } = await send(preflight());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(backend.created, []);
});

Deno.test("no bearer token: 401 before any client is built", async () => {
  for (const authorization of [null, "Basic dXNlcjpwYXNz"]) {
    const { res, backend } = await send(post({ report_id: "r-1" }, { authorization }));
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "Unauthorized" });
    assertEquals(backend.created, []);
  }
});

Deno.test("a token whose claims do not verify: 401; only the user-scoped client checked it", async () => {
  const { res, backend } = await send(post({ report_id: "r-1" }), { claims: null });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(backend.created, [{ client: "user", authorization: "Bearer user-jwt" }]);
  // The bare token, without its "Bearer " prefix.
  assertEquals(backend.calls.map((c) => [c.client, c.target, c.steps[0]]), [
    ["user", "auth:getClaims", ["getClaims", "user-jwt"]],
  ]);
});

Deno.test("no report_id: 400 before the service-role client is built", async () => {
  const { res, backend } = await send(post({ action: "toggle" }));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "report_id is required" });
  assertEquals(clientsBuilt(backend), ["user"]);
});

// ── Ownership ────────────────────────────────────────────────────────────

Deno.test("an unknown report: 403, nothing written", async () => {
  const { res, backend } = await send(post({ report_id: "r-404" }), { world: { report: false } });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Forbidden" });
  assertEquals(writes(backend.calls), []);
});

Deno.test("someone else's report: 403, nothing written — the owner comes from the project row, not the request", async () => {
  const { res, backend } = await send(post({ report_id: "r-1", action: "toggle", share_enabled: true }), {
    world: { owner: "u-2" },
  });
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "Forbidden" });
  assertEquals(writes(backend.calls), []);
  // report → project, both read by the service-role client.
  const reads = backend.calls.filter((c) => c.target === "flow_reports" || c.target === "projects");
  assertEquals(reads.map((c) => `${c.client} ${c.target}`), ["admin flow_reports", "admin projects"]);
  assertEquals(reads[1].steps.find(([step]) => step === "eq"), ["eq", "id", "p-1"]);
});

// ── Toggle ───────────────────────────────────────────────────────────────

Deno.test("toggle: only boolean fields are written; turning sharing on stamps the project name", async () => {
  const { res, backend } = await send(post({
    report_id: "r-1",
    action: "toggle",
    share_enabled: true,
    share_include_replay: false,
    share_include_feedback: "yes",
    certificate_id: "FLOW-FORGED00",
  }));
  assertEquals(res.status, 200);
  const update = { share_enabled: true, project_name: "My essay", share_include_replay: false };
  assertEquals(await res.json(), update);
  assertEquals(writes(backend.calls), [["admin", "flow_reports", update]]);
  const updateCall = backend.calls.find((c) => c.steps[0]?.[0] === "update");
  assertEquals(updateCall?.steps.find(([step]) => step === "eq"), ["eq", "id", "r-1"]);
});

Deno.test("toggle with no boolean field: 400, nothing written", async () => {
  const { res, backend } = await send(post({ report_id: "r-1", action: "toggle", share_enabled: "true" }));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "No valid fields to update" });
  assertEquals(writes(backend.calls), []);
});

Deno.test("toggle when the update fails: 500", async () => {
  const { res } = await send(post({ report_id: "r-1", action: "toggle", share_enabled: false }), {
    world: { failUpdate: true },
  });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Failed to update sharing status" });
});

// ── Share-link creation ──────────────────────────────────────────────────

Deno.test("create: a random UUID share token and a FLOW-XXXXXXXX report id, written as a public share", async () => {
  const { res, backend } = await send(post({ report_id: "r-1" }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertMatch(body.share_token, UUID_V4);
  assertMatch(body.certificate_id, REPORT_ID);
  assertEquals(body.project_name, "My essay");
  assertEquals(writes(backend.calls), [[
    "admin",
    "flow_reports",
    {
      share_token: body.share_token,
      certificate_id: body.certificate_id,
      share_enabled: true,
      share_visibility: "public",
      project_name: "My essay",
    },
  ]]);
  assertEquals(idsLookedUp(backend.calls), [body.certificate_id]);
});

Deno.test("create: a report id already taken is drawn again", async () => {
  const { res, backend } = await send(post({ report_id: "r-1" }), { world: { takenIds: 1 } });
  const body = await res.json();
  const [taken, free] = idsLookedUp(backend.calls);
  assertNotEquals(taken, free);
  assertEquals(body.certificate_id, free);
  assertMatch(String(taken), REPORT_ID);
});

Deno.test("create: three taken ids in a row: 500, nothing written", async () => {
  const { res, backend } = await send(post({ report_id: "r-1" }), { world: { takenIds: 3 } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Failed to generate unique certificate ID" });
  assertEquals(idsLookedUp(backend.calls).length, 3);
  assertEquals(writes(backend.calls), []);
});

Deno.test("create when the update fails: 500", async () => {
  const { res } = await send(post({ report_id: "r-1" }), { world: { failUpdate: true } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Failed to enable sharing" });
});
