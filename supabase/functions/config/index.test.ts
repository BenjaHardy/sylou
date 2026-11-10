// config/index.test.ts — the config handler over HTTP: CORS, the one method
// it serves, the capability flag it reports without a sign-in, and the local
// models it lists for a signed-in caller only.
// Fakes: _shared/_test_support.ts. A red test means the HTTP contract
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { HandlerDeps } from "../_shared/_handler.ts";
import { NOT_ANSWERING_ERROR } from "../_shared/_ollama.ts";
import {
  fakeBackend,
  fakeEnv,
  fakeLocalModels,
  importHandler,
  LOCAL_ENV,
  preflight,
  request,
  TEST_ORIGIN,
} from "../_shared/_test_support.ts";

const { handler } = await importHandler(() => import("./index.ts"));

const SIGNED_IN = "Bearer user-jwt";
const USER_CLAIMS = { sub: "user-1", role: "authenticated" };

interface SendOptions {
  env?: Record<string, string | undefined>;
  claims?: Record<string, unknown> | null;
  localModelInfo?: HandlerDeps["localModelInfo"];
}

async function send(req: Request, opts: SendOptions = {}) {
  const backend = fakeBackend({ claims: opts.claims });
  const local = fakeLocalModels({ "ollama/sylou-nemo-16k": 16_384 });
  const res = await handler(req, {
    env: fakeEnv(opts.env),
    createClient: backend.createClient,
    localModelInfo: opts.localModelInfo ?? local.localModelInfo,
  });
  return { res, backend, lookedUp: local.lookedUp };
}

Deno.test("preflight from the allowed origin: CORS headers for GET", async () => {
  const { res } = await send(preflight());
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
  assertEquals(res.headers.get("Vary"), "Origin");
});

Deno.test("an origin off the allow-list gets no Access-Control-Allow-Origin", async () => {
  const { res } = await send(preflight("https://elsewhere.test"));
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), null);
  assertEquals(res.headers.get("Vary"), "Origin");
});

Deno.test("any method but GET: 405, with the CORS headers", async () => {
  for (const method of ["POST", "PUT", "DELETE"]) {
    const { res } = await send(request(method));
    assertEquals(res.status, 405);
    assertEquals(await res.json(), { error: "Method not allowed" });
    assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  }
});

Deno.test("GET without a token: 200, and with no search key the answer is exactly the flag, off", async () => {
  const { res } = await send(request("GET"));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), TEST_ORIGIN);
  assertEquals(await res.json(), { web_search_enabled: false });
});

Deno.test("with the operator's search key: the answer is exactly the flag, on — the key stays on the server", async () => {
  const { res } = await send(request("GET"), { env: { BRAVE_SEARCH_API_KEY: "brave-key" } });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { web_search_enabled: true });
});

// ── Local models (_ollama.ts) ────────────────────────────────────────────

Deno.test("no local models listed: a signed-in caller gets the same answer, and no sign-in check or model lookup runs", async () => {
  const { res, backend, lookedUp } = await send(request("GET", SIGNED_IN), { claims: USER_CLAIMS });
  assertEquals(await res.json(), { web_search_enabled: false });
  assertEquals(backend.calls, []);
  assertEquals(lookedUp, []);
});

Deno.test("local models listed, no token: the same answer, and the model server is never asked", async () => {
  const { res, backend, lookedUp } = await send(request("GET"), { env: LOCAL_ENV, claims: USER_CLAIMS });
  assertEquals(await res.json(), { web_search_enabled: false });
  assertEquals(backend.calls, []);
  assertEquals(lookedUp, []);
});

Deno.test("local models listed, a token that does not verify or names no user: the same answer, no lookup", async () => {
  for (const claims of [null, { role: "anon" }, { sub: "user-1", role: "anon" }]) {
    const { res, backend, lookedUp } = await send(request("GET", SIGNED_IN), { env: LOCAL_ENV, claims });
    assertEquals(await res.json(), { web_search_enabled: false }, JSON.stringify(claims));
    assertEquals(backend.calls.map((c) => c.target), ["auth:getClaims"]);
    assertEquals(lookedUp, []);
  }
});

Deno.test("signed in: each listed model, in OLLAMA_MODELS order, with the window and tools its server reports", async () => {
  const reports: Record<string, { contextTokens: number; tools: boolean }> = {
    "ollama/sylou-ministral-8k": { contextTokens: 8_192, tools: false },
    "ollama/sylou-nemo-16k": { contextTokens: 16_384, tools: true },
  };
  const lookedUp: string[] = [];
  const { res, backend } = await send(request("GET", SIGNED_IN), {
    env: { ...LOCAL_ENV, OLLAMA_MODELS: "sylou-ministral-8k, sylou-nemo-16k", BRAVE_SEARCH_API_KEY: "brave-key" },
    claims: USER_CLAIMS,
    localModelInfo: (model) => {
      lookedUp.push(model);
      return Promise.resolve(reports[model]);
    },
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    web_search_enabled: true,
    local_models: [
      { id: "ollama/sylou-ministral-8k", name: "sylou-ministral-8k", context_tokens: 8_192, tools: false },
      { id: "ollama/sylou-nemo-16k", name: "sylou-nemo-16k", context_tokens: 16_384, tools: true },
    ],
  });
  assertEquals(lookedUp, ["ollama/sylou-ministral-8k", "ollama/sylou-nemo-16k"]);
  // The token was checked with the caller's own client, never the service role.
  assertEquals(backend.created, [{ client: "user", authorization: SIGNED_IN }]);
});

Deno.test("signed in: a model its server cannot confirm is listed with the reason, and a server not answering says so", async () => {
  const cloud = { error: '"sylou-cloud" runs in Ollama\'s cloud, not on this computer, so Sylou does not use it.' };
  const { res } = await send(request("GET", SIGNED_IN), {
    env: { ...LOCAL_ENV, OLLAMA_MODELS: "sylou-nemo-16k,sylou-cloud,sylou-gone" },
    claims: USER_CLAIMS,
    localModelInfo: (model) =>
      Promise.resolve(
        model === "ollama/sylou-nemo-16k"
          ? { contextTokens: 16_384, tools: true }
          : model === "ollama/sylou-cloud"
          ? cloud
          : { error: NOT_ANSWERING_ERROR },
      ),
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    web_search_enabled: false,
    local_models: [
      { id: "ollama/sylou-nemo-16k", name: "sylou-nemo-16k", context_tokens: 16_384, tools: true },
      { id: "ollama/sylou-cloud", name: "sylou-cloud", problem: cloud.error },
      { id: "ollama/sylou-gone", name: "sylou-gone", not_answering: true },
    ],
  });
});

Deno.test("a sign-in check that fails outright: 200 with the same answer as without a token, no lookup", async () => {
  const local = fakeLocalModels({ "ollama/sylou-nemo-16k": 16_384 });
  const res = await handler(request("GET", SIGNED_IN), {
    env: fakeEnv(LOCAL_ENV),
    createClient: (() => {
      throw new Error("auth service unreachable");
    }) as unknown as HandlerDeps["createClient"],
    localModelInfo: local.localModelInfo,
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { web_search_enabled: false });
  assertEquals(local.lookedUp, []);
});
