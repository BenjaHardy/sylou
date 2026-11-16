// The router of a Sylou Local install's functions container.
//
// It serves exactly the eight functions this repository has, each from the
// bundle built into the image, and gives every worker:
//
//   * only the settings the functions read — never the whole container
//     environment, and never a database address or password;
//   * the keys from the files Docker mounted, so no key is an environment
//     variable of the container itself;
//   * a list of the addresses it may reach, and nothing else;
//   * a fresh start per request, with the limits A0 measured on a laptop
//     with no usable GPU.
//
// Token checks are left to the functions, as on hosted Sylou, where the
// platform is told not to make them (verify_jwt = false).

/**
 * The part of the runtime's own API this router uses. It exists only inside
 * the edge runtime, so it is spelled out here rather than imported.
 */
declare const EdgeRuntime: {
  userWorkers: {
    create(options: Record<string, unknown>): Promise<{ fetch(request: Request): Promise<Response> }>;
  };
};

/** The eight functions. A new folder is unreachable until it is listed. */
const NAMES = new Set([
  "analysis",
  "chat",
  "config",
  "context-prompt",
  "delete-account",
  "editor-action",
  "extract-text",
  "share-report",
]);

/** Settings copied from this container's environment when they are set. */
const PLAIN = [
  "SUPABASE_URL",
  "ALLOWED_ORIGIN",
  "OLLAMA_URL",
  "OLLAMA_MODELS",
  "SYLOU_LOCAL_ONLY",
  // Off unless an operator debugging their own install turns it on; the
  // functions warn in their logs while it is.
  "SYLOU_DEBUG_LOG_CONTENT",
  "SYLOU_INSTANCE_LABEL",
  "SYLOU_INSTANCE_DOMAIN",
  "SYLOU_VERSION",
  "SYLOU_COMMIT_HASH",
];

/** Keys, each read from /run/secrets/<the name in lower case>. */
const SECRETS = [
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ANTHROPIC_API_KEY",
  "MISTRAL_API_KEY",
  "DEEPSEEK_API_KEY",
  "BRAVE_SEARCH_API_KEY",
];

/** The cloud services the functions may reach, when they are configured. */
const PROVIDER_HOSTS: Record<string, string> = {
  ANTHROPIC_API_KEY: "api.anthropic.com:443",
  MISTRAL_API_KEY: "api.mistral.ai:443",
  DEEPSEEK_API_KEY: "api.deepseek.com:443",
  BRAVE_SEARCH_API_KEY: "api.search.brave.com:443",
};

// A0 measured each of these. The runtime's own defaults are 256 MB, one
// second of processor time (two hard) and a 400-second clock, counted from
// the worker's start rather than the request's — which killed slow local
// answers after about five minutes with nothing saved.
const WORKER = {
  memoryLimitMb: 256,
  workerTimeoutMs: 600_000,
  cpuTimeSoftLimitMs: 20_000,
  cpuTimeHardLimitMs: 30_000,
  // A fresh worker per request, so every request gets its own budgets.
  forceCreate: true,
  noModuleCache: true,
  // An eszip worker never fetches a module; this says so out loud.
  allowRemoteModules: false,
};

const ON = new Set(["true", "1", "yes", "on"]);
const localOnly = ON.has((Deno.env.get("SYLOU_LOCAL_ONLY") ?? "").trim().toLowerCase());

function readSecret(name: string): string | undefined {
  try {
    const value = Deno.readTextFileSync(`/run/secrets/${name.toLowerCase()}`).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/** host:port of the Ollama address, when one is set. */
function ollamaAddress(): string | undefined {
  const url = (Deno.env.get("OLLAMA_URL") ?? "").trim();
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`;
  } catch {
    return undefined;
  }
}

const workerEnv: [string, string][] = [];
for (const name of PLAIN) {
  const value = Deno.env.get(name);
  if (value) workerEnv.push([name, value]);
}
const configured: string[] = [];
for (const name of SECRETS) {
  const value = readSecret(name);
  if (!value) continue;
  workerEnv.push([name, value]);
  configured.push(name);
}

// Where a worker may go: the gateway for its own database and storage calls,
// a model on this computer when one is set, and a cloud provider only when
// its key is configured and local-only mode is off. Everything else is
// refused by the runtime itself, not by our code.
const allowNet: string[] = [];
const gateway = (Deno.env.get("SUPABASE_URL") ?? "").trim();
if (gateway) {
  try {
    const parsed = new URL(gateway);
    allowNet.push(`${parsed.hostname}:${parsed.port || "80"}`);
  } catch {
    // An unusable address is left out; the functions then fail loudly.
  }
}
const ollama = ollamaAddress();
if (ollama) allowNet.push(ollama);
if (!localOnly) {
  for (const name of configured) {
    const host = PROVIDER_HOSTS[name];
    if (host) allowNet.push(host);
  }
}

console.log(
  `router: ${NAMES.size} functions; settings ${workerEnv.map(([name]) => name).join(", ")}; ` +
    `may reach ${allowNet.join(", ") || "nothing"}${localOnly ? " (local-only mode)" : ""}`,
);

const bundles = new Map<string, Uint8Array>();
async function bundleOf(name: string): Promise<Uint8Array> {
  let bundle = bundles.get(name);
  if (!bundle) {
    bundle = await Deno.readFile(`/home/deno/eszip/${name}.eszip`);
    bundles.set(name, bundle);
  }
  return bundle;
}

function json(status: number, body: unknown): Response {
  // No cross-site header, ever: Supabase's own router answers its errors
  // with Access-Control-Allow-Origin: *.
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  const name = new URL(req.url).pathname.split("/")[1] ?? "";
  if (!NAMES.has(name)) return json(404, { error: "Requested function was not found" });

  try {
    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `/home/deno/functions/${name}`,
      maybeEszip: await bundleOf(name),
      maybeEntrypoint: `file:///src/${name}/index.ts`,
      envVars: workerEnv,
      // What a worker may do at all. An empty list means "no limit on this
      // one", a filled one means exactly those, and anything left out is
      // refused — so a worker can never run a program, load a native
      // library or import a module from the network.
      //
      // Reading its own environment has no limit because its environment is
      // only what we just handed it; writing is the container's tmpfs.
      permissions: {
        allow_net: allowNet,
        allow_env: [],
        allow_read: [],
        allow_write: ["/tmp"],
        allow_sys: [],
      },
      ...WORKER,
    });
    // The incoming request object itself: a rebuilt one fails inside the
    // runtime with "reading 'streamRid'".
    return await worker.fetch(req);
  } catch (error) {
    console.error(`router: ${name}:`, error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("idle timeout")) {
      return json(504, { error: "Request idle timeout reached" });
    }
    return json(500, { error: "Function failed (see logs)" });
  }
});
