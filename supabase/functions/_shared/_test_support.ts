// _shared/_test_support.ts — fakes for the handler (HTTP) tests.
//
// A function's index.ts calls Deno.serve when it is imported, so a test
// loads it through importHandler(): Deno.serve becomes a no-op first, and
// ALLOWED_ORIGIN is set for _cors.ts, which reads it at module load (the
// test task grants env access to that one variable). The fakes stand in for
// everything a handler's deps carry: the environment, the Supabase clients
// (a chained query builder recording one ordered call log, as in the persist
// tests) and the provider (canned JSON and SSE replies, Mistral shape).

import type { HandlerDeps } from "./_handler.ts";

export const TEST_ORIGIN = "https://app.sylou.test";

/** What a deployed function finds in its environment. */
export const TEST_ENV: Readonly<Record<string, string>> = {
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  MISTRAL_API_KEY: "mistral-key",
};

/** Imports a function's index.ts without starting a server:
 *  `const { handler } = await importHandler(() => import("./index.ts"));` */
export async function importHandler<T>(load: () => Promise<T>): Promise<T> {
  Object.defineProperty(Deno, "serve", { value: () => ({}), configurable: true, writable: true });
  Deno.env.set("ALLOWED_ORIGIN", TEST_ORIGIN);
  return await load();
}

/** A real provider model id that is deliberately not on the allowlist: what
 *  a retired id, or any other saved value the menu does not offer, looks
 *  like to a handler. */
export const UNLISTED_MODEL = "claude-opus-4-1";

/** TEST_ENV with some variables changed; `undefined` removes one. */
export function fakeEnv(changes: Record<string, string | undefined> = {}): HandlerDeps["env"] {
  const values: Record<string, string | undefined> = { ...TEST_ENV, ...changes };
  return { get: (name: string) => values[name] };
}

// ── Requests ─────────────────────────────────────────────────────────────

const FUNCTION_URL = "https://project.supabase.test/functions/v1/under-test";

/** A browser's CORS preflight. */
export function preflight(origin = TEST_ORIGIN): Request {
  return new Request(FUNCTION_URL, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  });
}

/** A browser's JSON POST, signed in by default: `authorization` is the whole
 *  header value, and null sends none. */
export function post(body: unknown, opts: { authorization?: string | null; origin?: string } = {}): Request {
  const headers = new Headers({ "Content-Type": "application/json", Origin: opts.origin ?? TEST_ORIGIN });
  const authorization = opts.authorization === undefined ? "Bearer user-jwt" : opts.authorization;
  if (authorization !== null) headers.set("Authorization", authorization);
  return new Request(FUNCTION_URL, { method: "POST", headers, body: JSON.stringify(body) });
}

// ── Supabase ─────────────────────────────────────────────────────────────

/** One finished query, RPC or token check, as the handler issued it. */
export interface DbCall {
  /** The client that issued it: the caller's user-scoped one or the service-role one. */
  client: "user" | "admin";
  /** The table, `rpc:<name>`, `storage:<bucket>`, or `auth:getUser` / `auth:getClaims`. */
  target: string;
  /** The builder steps in order, e.g. ["select", "id"], ["eq", "id", "t-1"], ["single"]. */
  steps: unknown[][];
}

export interface DbResult {
  data: unknown;
  error: unknown;
}

const NO_ROWS: DbResult = { data: null, error: null };

/** The query builder, reduced to the steps the handlers chain. Every step is
 *  recorded; the query finishes when it ends in single()/maybeSingle() or is
 *  awaited as it stands. */
class FakeQuery {
  constructor(
    private readonly call: DbCall,
    private readonly finish: (call: DbCall) => DbResult,
  ) {}

  private step(name: string, args: unknown[]): this {
    this.call.steps.push([name, ...args]);
    return this;
  }

  select(...args: unknown[]) { return this.step("select", args); }
  insert(...args: unknown[]) { return this.step("insert", args); }
  update(...args: unknown[]) { return this.step("update", args); }
  upsert(...args: unknown[]) { return this.step("upsert", args); }
  delete(...args: unknown[]) { return this.step("delete", args); }
  eq(...args: unknown[]) { return this.step("eq", args); }
  neq(...args: unknown[]) { return this.step("neq", args); }
  gt(...args: unknown[]) { return this.step("gt", args); }
  gte(...args: unknown[]) { return this.step("gte", args); }
  lt(...args: unknown[]) { return this.step("lt", args); }
  lte(...args: unknown[]) { return this.step("lte", args); }
  in(...args: unknown[]) { return this.step("in", args); }
  is(...args: unknown[]) { return this.step("is", args); }
  order(...args: unknown[]) { return this.step("order", args); }
  limit(...args: unknown[]) { return this.step("limit", args); }

  single(): Promise<DbResult> {
    return Promise.resolve(this.step("single", []).finish(this.call));
  }

  maybeSingle(): Promise<DbResult> {
    return Promise.resolve(this.step("maybeSingle", []).finish(this.call));
  }

  // supabase-js builders are awaited directly (`await from(t).select().eq()`).
  then<A = DbResult, B = never>(
    onFulfilled?: ((value: DbResult) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve(this.finish(this.call)).then(onFulfilled, onRejected);
  }
}

export interface FakeBackendOptions {
  /** auth.getUser's answer: the caller, or null for a missing, expired or forged token. */
  user?: { id: string; email?: string } | null;
  /** auth.getClaims's answer (share-report): the token's claims, or null when it does not verify. */
  claims?: Record<string, unknown> | null;
  /** The result of each finished call; a call it does not answer finds no rows. */
  respond?: (call: DbCall) => DbResult | undefined;
}

/** Both Supabase clients, and the createClient that hands them out by key:
 *  the anon key gets the user-scoped client, the service-role key the admin one.
 *  `created` lists the clients in creation order with the Authorization header
 *  each one carries. */
export function fakeBackend(opts: FakeBackendOptions = {}) {
  const calls: DbCall[] = [];
  const created: { client: "user" | "admin"; authorization: string | null }[] = [];
  const finish = (call: DbCall): DbResult => {
    calls.push(call);
    return opts.respond?.(call) ?? NO_ROWS;
  };
  const makeClient = (client: "user" | "admin") => ({
    auth: {
      getUser: () => {
        calls.push({ client, target: "auth:getUser", steps: [["getUser"]] });
        return Promise.resolve(
          opts.user
            ? { data: { user: opts.user }, error: null }
            : { data: { user: null }, error: { message: "invalid JWT" } },
        );
      },
      getClaims: (token: string) => {
        calls.push({ client, target: "auth:getClaims", steps: [["getClaims", token]] });
        return Promise.resolve(
          opts.claims
            ? { data: { claims: opts.claims }, error: null }
            : { data: null, error: { message: "invalid JWT" } },
        );
      },
    },
    from: (table: string) => new FakeQuery({ client, target: table, steps: [] }, finish),
    rpc: (name: string, args: Record<string, unknown>) =>
      Promise.resolve(finish({ client, target: `rpc:${name}`, steps: [["rpc", args]] })),
    storage: {
      from: (bucket: string) => ({
        download: (path: string) =>
          Promise.resolve(finish({ client, target: `storage:${bucket}`, steps: [["download", path]] })),
      }),
    },
  });
  const clients = { user: makeClient("user"), admin: makeClient("admin") };
  const createClient = (
    _url: string,
    key: string,
    options?: { global?: { headers?: Record<string, string> } },
  ) => {
    const client = key === TEST_ENV.SUPABASE_SERVICE_ROLE_KEY
      ? "admin"
      : key === TEST_ENV.SUPABASE_ANON_KEY
      ? "user"
      : null;
    if (!client) throw new Error(`createClient called with an unexpected key: ${key}`);
    created.push({ client, authorization: options?.global?.headers?.Authorization ?? null });
    return clients[client];
  };
  return { calls, created, createClient: createClient as unknown as HandlerDeps["createClient"] };
}

/** The writes a handler made, as [client, table, values] — inserts and updates. */
export function writes(calls: DbCall[]): [string, string, unknown][] {
  return calls.flatMap((c) =>
    c.steps
      .filter(([step]) => step === "insert" || step === "update" || step === "upsert")
      .map(([, values]): [string, string, unknown] => [c.client, c.target, values])
  );
}

// ── Provider ─────────────────────────────────────────────────────────────

type LLMArgs = Parameters<HandlerDeps["callLLM"]>[0];

/** A provider answering each call with the next canned reply and recording
 *  what it was sent; a call past the last reply fails the request. */
export function fakeProvider(...replies: Response[]) {
  const calls: LLMArgs[] = [];
  const callLLM = (args: LLMArgs): Promise<Response> => {
    calls.push(args);
    const reply = replies.shift();
    return reply ? Promise.resolve(reply) : Promise.reject(new Error(`unexpected provider call #${calls.length}`));
  };
  return { calls, callLLM: callLLM as HandlerDeps["callLLM"] };
}

/** A streamed reply: a reasoning chunk first when `thinking`, then one chunk
 *  per text delta, the finish reason and [DONE]. */
export function streamedReply(deltas: string[], opts: { thinking?: boolean; finish?: string } = {}): Response {
  const chunks: unknown[] = [];
  if (opts.thinking) {
    chunks.push({ choices: [{ delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "Weighing it up." }] }] } }] });
  }
  for (const content of deltas) chunks.push({ choices: [{ delta: { content } }] });
  chunks.push({ choices: [{ delta: {}, finish_reason: opts.finish ?? "stop" }] });
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

/** A non-streamed reply: text, or tool calls. */
export function jsonReply(
  message: { content?: string; toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] },
): Response {
  const toolCalls = message.toolCalls?.map((tc) => ({
    id: tc.id,
    type: "function",
    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
  }));
  return Response.json({
    choices: [{
      message: { role: "assistant", content: message.content ?? "", ...(toolCalls ? { tool_calls: toolCalls } : {}) },
      finish_reason: toolCalls ? "tool_calls" : "stop",
    }],
  });
}

/** The `data:` events of an SSE response, in order; comment lines
 *  (keep-alives) are skipped. */
export async function readEvents(res: Response): Promise<Record<string, unknown>[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((block) => block.startsWith("data: "))
    .map((block) => JSON.parse(block.slice("data: ".length)));
}
