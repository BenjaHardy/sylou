// delete-account/index.test.ts — the delete-account handler over HTTP: CORS,
// the token check, that only the caller's own files and account are erased
// (files first, through the service-role client), and the failures that
// leave the account in place.
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeEnv,
  importHandler,
  post,
  preflight,
  request,
  TEST_ORIGIN,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

interface World {
  /** The objects in the imports bucket, by path. */
  files?: string[];
  /** The listing of this folder fails. */
  failList?: string;
  /** Every removal fails. */
  failRemove?: boolean;
  /** The account deletion fails. */
  failDelete?: boolean;
}

/** One level of the bucket under `prefix`, as storage list() returns it:
 *  a folder with a null id, a file with an id. */
function entriesUnder(files: string[], prefix: string) {
  const entries = new Map<string, string | null>();
  for (const path of files) {
    if (!path.startsWith(`${prefix}/`)) continue;
    const [name, ...deeper] = path.slice(prefix.length + 1).split("/");
    entries.set(name, deeper.length > 0 ? null : `object-${path}`);
  }
  return [...entries].map(([name, id]) => ({ name, id }));
}

/** u-1's stored files, and another user's under u-2. */
function world(w: World) {
  const files = [...(w.files ?? []), "u-2/p-9/theirs.txt"];
  return (call: DbCall): DbResult | undefined => {
    const [step, arg, options] = call.steps[0];
    if (call.target === "auth:deleteUser") {
      return { data: null, error: w.failDelete ? { message: "delete denied" } : null };
    }
    if (call.target !== "storage:imports") return undefined;
    if (step === "list") {
      if (arg === w.failList) return { data: null, error: { message: "list denied" } };
      const { limit, offset } = options as { limit: number; offset: number };
      return { data: entriesUnder(files, String(arg)).slice(offset, offset + limit), error: null };
    }
    if (step === "remove") {
      return w.failRemove ? { data: null, error: { message: "remove denied" } } : { data: [], error: null };
    }
    return undefined;
  };
}

async function send(req: Request, opts: { world?: World; user?: { id: string } | null } = {}) {
  const backend = fakeBackend({
    user: opts.user === undefined ? { id: "u-1" } : opts.user,
    respond: world(opts.world ?? {}),
  });
  const res = await handler(req, { env: fakeEnv(), createClient: backend.createClient });
  return { res, backend };
}

const storage = (calls: DbCall[], step: "list" | "remove") =>
  calls.filter((c) => c.target === "storage:imports" && c.steps[0][0] === step);
/** The folders listed, with the page asked for. */
const listed = (calls: DbCall[]) => storage(calls, "list").map((c) => [c.steps[0][1], c.steps[0][2]]);
/** The paths of each removal, in order. */
const removed = (calls: DbCall[]) => storage(calls, "remove").map((c) => c.steps[0][1] as string[]);
/** The user ids deleted. */
const deleted = (calls: DbCall[]) =>
  calls.filter((c) => c.target === "auth:deleteUser").map((c) => c.steps[0][1]);

const PROJECT_FILES = ["u-1/p-1/notes.txt", "u-1/p-1/paper.pdf", "u-1/p-2/draft.docx"];
const page = (offset: number) => ({ limit: 1000, offset });
const filesIn = (folder: string, count: number) => Array.from({ length: count }, (_, i) => `${folder}/file-${i}.txt`);

// ── CORS, method and the token check ─────────────────────────────────────

Deno.test("preflight from the allowed origin: CORS headers for POST, and no client is built", async () => {
  const { res, backend } = await send(preflight());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "POST, OPTIONS");
  assertEquals(res.headers.get("Vary"), "Origin");
  assertEquals(backend.created, []);
});

Deno.test("a GET: 405 before any client is built", async () => {
  const { res, backend } = await send(request("GET"));
  assertEquals(res.status, 405);
  assertEquals(await res.json(), { error: "Method not allowed" });
  assertEquals(backend.created, []);
});

Deno.test("no bearer token: 401 before any client is built", async () => {
  for (const authorization of [null, "Basic dXNlcjpwYXNz"]) {
    const { res, backend } = await send(post({}, { authorization }));
    assertEquals(res.status, 401);
    assertEquals(await res.json(), { error: "Unauthorized" });
    assertEquals(backend.created, []);
  }
});

Deno.test("a token Supabase Auth rejects: 401; only the user-scoped client checked it, nothing listed or deleted", async () => {
  const { res, backend } = await send(post({}), { user: null, world: { files: PROJECT_FILES } });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "Unauthorized" });
  assertEquals(backend.created, [{ client: "user", authorization: "Bearer user-jwt" }]);
  assertEquals(backend.calls.map((c) => `${c.client} ${c.target}`), ["user auth:getUser"]);
});

// ── Only the caller, files first ─────────────────────────────────────────

Deno.test("a body naming another user is never read: only u-1's folder is listed and only u-1 is deleted", async () => {
  const req = post({ user_id: "u-2", user_uuid: "u-2" });
  const { res, backend } = await send(req, { world: { files: PROJECT_FILES } });
  assertEquals(res.status, 200);
  assertEquals(req.bodyUsed, false);
  assertEquals(listed(backend.calls).map(([folder]) => folder), ["u-1", "u-1/p-1", "u-1/p-2"]);
  assert(removed(backend.calls).flat().every((path) => path.startsWith("u-1/")));
  assertEquals(deleted(backend.calls), ["u-1"]);
});

Deno.test("the purge and the deletion run on the service-role client; the caller's client only checks the token", async () => {
  const { backend } = await send(post({}), { world: { files: PROJECT_FILES } });
  assertEquals(backend.created, [
    { client: "user", authorization: "Bearer user-jwt" },
    { client: "admin", authorization: null },
  ]);
  assertEquals(backend.calls.filter((c) => c.client === "user").map((c) => c.target), ["auth:getUser"]);
  assert(backend.calls.filter((c) => c.target !== "auth:getUser").every((c) => c.client === "admin"));
});

Deno.test("every file of every project, and a stray file in the user folder, is removed before the one account deletion", async () => {
  const { res, backend } = await send(post({}), { world: { files: [...PROJECT_FILES, "u-1/stray.txt"] } });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { success: true });
  assertEquals(removed(backend.calls).flat().sort(), [...PROJECT_FILES, "u-1/stray.txt"].sort());
  const lastRemoval = backend.calls.findLastIndex((c) => c.steps[0][0] === "remove");
  const deletion = backend.calls.findIndex((c) => c.target === "auth:deleteUser");
  assert(lastRemoval < deletion);
  assertEquals(deleted(backend.calls), ["u-1"]);
});

Deno.test("no stored files: nothing to remove, and the account is still deleted", async () => {
  const { res, backend } = await send(post({}));
  assertEquals(res.status, 200);
  assertEquals(removed(backend.calls), []);
  assertEquals(deleted(backend.calls), ["u-1"]);
});

Deno.test("a folder holding more than a page of files is listed page by page", async () => {
  const files = filesIn("u-1/p-1", 1001);
  const { backend } = await send(post({}), { world: { files } });
  assertEquals(listed(backend.calls), [["u-1", page(0)], ["u-1/p-1", page(0)], ["u-1/p-1", page(1000)]]);
  assertEquals(removed(backend.calls).flat().length, 1001);
});

Deno.test("files are removed in batches of 100", async () => {
  const { backend } = await send(post({}), { world: { files: filesIn("u-1/p-1", 250) } });
  assertEquals(removed(backend.calls).map((batch) => batch.length), [100, 100, 50]);
});

// ── Failures that leave the account in place ─────────────────────────────

Deno.test("a folder that cannot be listed: 500, and the account is not deleted", async () => {
  const { res, backend } = await send(post({}), { world: { files: PROJECT_FILES, failList: "u-1/p-2" } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "storage_purge_failed" });
  assertEquals(removed(backend.calls), []);
  assertEquals(deleted(backend.calls), []);
});

Deno.test("a removal that fails: 500, and the account is not deleted", async () => {
  const { res, backend } = await send(post({}), { world: { files: PROJECT_FILES, failRemove: true } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "storage_purge_failed" });
  assertEquals(deleted(backend.calls), []);
});

Deno.test("a folder inside a project folder: 500 before anything is removed, and the account is not deleted", async () => {
  const { res, backend } = await send(post({}), { world: { files: [...PROJECT_FILES, "u-1/p-1/nested/deep.txt"] } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "storage_purge_failed" });
  assertEquals(removed(backend.calls), []);
  assertEquals(deleted(backend.calls), []);
});

Deno.test("the account deletion fails after the purge: 500 account_delete_failed", async () => {
  const { res, backend } = await send(post({}), { world: { files: PROJECT_FILES, failDelete: true } });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "account_delete_failed" });
  assertEquals(removed(backend.calls).flat().sort(), [...PROJECT_FILES].sort());
});
