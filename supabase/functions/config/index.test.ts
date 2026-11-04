// config/index.test.ts — the config handler over HTTP: CORS, the one method
// it serves, and the capability flag it reports without a sign-in.
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fakeEnv, importHandler, preflight, request, TEST_ORIGIN } from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const send = (req: Request, env: Record<string, string | undefined> = {}) => handler(req, { env: fakeEnv(env) });

Deno.test("preflight from the allowed origin: CORS headers for GET", () => {
  const res = send(preflight());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  assertEquals(res.headers.get("Vary"), "Origin");
});

Deno.test("an origin off the allow-list gets no Access-Control-Allow-Origin", () => {
  const res = send(preflight("https://elsewhere.test"));
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(res.headers.get("Vary"), "Origin");
});

Deno.test("any method but GET: 405, with the CORS headers", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = send(request(method));
    assertEquals(res.status, 405);
    assertEquals(await res.json(), { error: "Method not allowed" });
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  }
});

Deno.test("GET without a token: 200, and with no search key the answer is exactly the flag, off", async () => {
  const res = send(request("GET"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  assertEquals(await res.json(), { web_search_enabled: false });
});

Deno.test("with the operator's search key: the answer is exactly the flag, on — the key stays on the server", async () => {
  const res = send(request("GET"), { BRAVE_SEARCH_API_KEY: "brave-key" });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { web_search_enabled: true });
});
