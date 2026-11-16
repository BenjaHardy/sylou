// What the Sylou Local recipe promises, checked against the recipe Docker
// itself resolves — `docker compose config`, with the anchors merged and the
// settings filled in, which is what a running install is made from.
//
// Nothing in a build reads compose.yaml, so only this test notices when a
// rule is dropped. The package tests (A2-3) check the same claims again on a
// running install; this one needs no daemon, only the docker command.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";

const PACKAGE_DIR = fromFileUrl(new URL("../", import.meta.url));
const COMPOSE = join(PACKAGE_DIR, "compose.yaml");

/** Every secret file the recipe names, as `sylou setup` creates them. */
const SECRET_FILES = [
  "jwt_secret",
  "anon_key",
  "service_role_key",
  "pg_supabase_admin_password",
  "pg_postgres_password",
  "pg_authenticator_password",
  "pg_auth_admin_password",
  "pg_storage_admin_password",
  "pgrst_db_uri",
  "anthropic_api_key",
  "mistral_api_key",
  "deepseek_api_key",
  "brave_search_api_key",
];

/** Written into every secret file: it must not come back in the recipe. */
const SECRET_MARK = "SECRET-VALUE-THAT-MUST-NEVER-APPEAR";

/** Values Supabase ships in its own example file, which must be nowhere. */
const SUPABASE_DEMO_VALUES = [
  "your-super-secret-jwt-token-with-at-least-32-characters-long",
  "your-super-secret-and-long-postgres-password",
  "this_password_is_insecure_and_should_be_updated",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9", // the demo anon and service keys
];

/** A stand-in install folder: the secret files, and nothing else. */
function stagedInstall(): string {
  const dir = Deno.makeTempDirSync({ prefix: "sylou-recipe-" });
  Deno.mkdirSync(join(dir, "config", "secrets"), { recursive: true });
  for (const name of SECRET_FILES) {
    Deno.writeTextFileSync(join(dir, "config", "secrets", name), `${SECRET_MARK}-${name}`);
  }
  Deno.writeTextFileSync(
    join(dir, "settings.env"),
    ["SYLOU_PORT=8080", "SYLOU_IMAGE_TAG=dev", "SYLOU_INSTANCE_LABEL=local", ""].join("\n"),
  );
  return dir;
}

interface Service {
  image?: string;
  build?: unknown;
  restart?: string;
  user?: string;
  read_only?: boolean;
  privileged?: boolean;
  cap_drop?: string[];
  cap_add?: string[];
  security_opt?: string[];
  pids_limit?: number;
  mem_limit?: number | string;
  entrypoint?: string[];
  command?: string[];
  environment?: Record<string, string | null>;
  networks?: Record<string, unknown>;
  ports?: { host_ip?: string; published?: string | number; target?: number }[];
  volumes?: { type?: string; source?: string; target?: string }[];
  secrets?: ({ source?: string } | string)[];
  profiles?: string[];
  healthcheck?: Record<string, unknown>;
}

/** The recipe as Docker resolves it, both profiles included. */
function resolved(): { raw: string; services: Record<string, Service>; networks: Record<string, Record<string, unknown>> } {
  const dir = stagedInstall();
  try {
    const run = new Deno.Command("docker", {
      args: [
        "compose",
        "--project-directory",
        dir,
        "-f",
        COMPOSE,
        "--env-file",
        join(dir, "settings.env"),
        "--profile",
        "tools",
        "--profile",
        "local-only",
        "config",
        "--format",
        "json",
      ],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const out = new TextDecoder().decode(run.stdout);
    const err = new TextDecoder().decode(run.stderr);
    assert(run.success, `docker compose config failed:\n${err}`);
    const parsed = JSON.parse(out);
    return { raw: out, services: parsed.services ?? {}, networks: parsed.networks ?? {} };
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

const recipe = resolved();
const services = recipe.services;
const named = (name: string): Service => {
  const service = services[name];
  assert(service, `the recipe has no service "${name}"`);
  return service;
};

/** The services that stay up, as opposed to the one-shots. */
const LONG_RUNNING = ["entry", "web", "gateway", "functions", "db", "auth", "rest", "storage"];
const ONE_SHOTS = ["migrate", "tools", "dump", "load"];

Deno.test("the recipe holds the services Sylou needs, and nothing else", () => {
  assertEquals(
    Object.keys(services).sort(),
    ["auth", "db", "dump", "entry", "functions", "gateway", "load", "migrate", "relay", "rest", "storage", "tools", "web"],
  );
});

Deno.test("nothing of Supabase's dashboard, pooler or extras is installed", () => {
  const unwanted = ["studio", "meta", "realtime", "imgproxy", "supavisor", "analytics", "vector", "kong", "supabase-pooler"];
  for (const name of unwanted) {
    assert(!(name in services), `the recipe installs ${name}`);
  }
  for (const [name, service] of Object.entries(services)) {
    const image = service.image ?? "";
    for (const part of ["studio", "postgres-meta", "realtime", "imgproxy", "supavisor", "logflare", "kong", "envoy"]) {
      assert(!image.includes(part), `${name} runs ${part} (${image})`);
    }
  }
});

Deno.test("one published port: 127.0.0.1 only, and it belongs to the letter box", () => {
  const publishing = Object.entries(services).filter(([, service]) => (service.ports ?? []).length > 0);
  assertEquals(publishing.map(([name]) => name), ["entry"]);
  const ports = named("entry").ports ?? [];
  assertEquals(ports.length, 1);
  assertEquals(ports[0].host_ip, "127.0.0.1");
  assertEquals(String(ports[0].published), "8080");
  assertEquals(ports[0].target, 8080);
});

Deno.test("only the letter box and the functions have a network with a way out", () => {
  for (const [name, service] of Object.entries(services)) {
    const networks = Object.keys(service.networks ?? {}).sort();
    const allowed: Record<string, string[]> = {
      // The one container with a published port, because Docker cannot
      // publish one from a container that has no such network (D25).
      entry: ["backend", "frontdoor"],
      // AI providers and web search; local-only mode takes this away.
      functions: ["backend", "egress"],
      // Only started in local-only mode, and only to reach Ollama here.
      relay: ["backend", "egress"],
    };
    assertEquals(networks, allowed[name] ?? ["backend"], `${name}'s networks`);
  }
  // The front door reads every request, so it is on the inside (D25).
  assertEquals(Object.keys(named("web").networks ?? {}), ["backend"]);
});

Deno.test("the backend network has no route out and no address on the computer", () => {
  const backend = recipe.networks.backend as { internal?: boolean; driver_opts?: Record<string, string> };
  assertEquals(backend.internal, true);
  assertEquals(backend.driver_opts?.["com.docker.network.bridge.gateway_mode_ipv4"], "isolated");
  const frontdoor = recipe.networks.frontdoor as { internal?: boolean; driver_opts?: Record<string, string> };
  assertEquals(frontdoor.driver_opts?.["com.docker.network.bridge.enable_ip_masquerade"], "false");
});

Deno.test("every image Sylou does not build is pinned to one exact build", () => {
  for (const [name, service] of Object.entries(services)) {
    const image = service.image ?? "";
    if (image.startsWith("ghcr.io/benjahardy/")) {
      // Ours: pinned by the release tag, and buildable from a clone instead.
      assert(service.build, `${name} has no build entry, so it cannot be built from source`);
      continue;
    }
    assert(image.includes("@sha256:"), `${name} is not pinned by digest (${image})`);
  }
});

Deno.test("no secret is an environment variable, and no secret value is in the recipe", () => {
  assert(!recipe.raw.includes(SECRET_MARK), "a secret file's contents reached the resolved recipe");
  for (const demo of SUPABASE_DEMO_VALUES) {
    assert(!recipe.raw.includes(demo), `Supabase's example value ${demo.slice(0, 24)}… is in the recipe`);
  }
  const forbidden = [
    "POSTGRES_PASSWORD",
    "GOTRUE_JWT_SECRET",
    "GOTRUE_DB_DATABASE_URL",
    "PGRST_JWT_SECRET_FILE",
    "ANON_KEY",
    "SERVICE_KEY",
    "SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
    "MISTRAL_API_KEY",
    "DEEPSEEK_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "SUPABASE_DB_URL",
    "DATABASE_URL",
    "AUTH_JWT_SECRET",
  ];
  for (const [name, service] of Object.entries(services)) {
    for (const key of Object.keys(service.environment ?? {})) {
      assert(!forbidden.includes(key), `${name} takes ${key} as an environment variable`);
    }
  }
  // The two that read a file do say so, by path.
  const rest = named("rest").environment ?? {};
  assertEquals(rest.PGRST_DB_URI, "@/run/secrets/pgrst_db_uri");
  assertEquals(rest.PGRST_JWT_SECRET, "@/run/secrets/jwt_secret");
  assertEquals((named("db").environment ?? {}).POSTGRES_PASSWORD_FILE, "/run/secrets/pg_supabase_admin_password");
});

Deno.test("the functions are never given the database's address or password", () => {
  const functions = named("functions");
  const sources = (functions.secrets ?? []).map((s) => (typeof s === "string" ? s : s.source));
  for (const forbidden of ["pg_postgres_password", "pg_supabase_admin_password", "pgrst_db_uri"]) {
    assert(!sources.includes(forbidden), `the functions are given ${forbidden}`);
  }
  // Only the tools container is, and only on the inside.
  assert((named("tools").secrets ?? []).some((s) => (typeof s === "string" ? s : s.source) === "pg_postgres_password"));
});

Deno.test("every container is hardened the same way", () => {
  for (const [name, service] of Object.entries(services)) {
    assertEquals(service.cap_drop, ["ALL"], `${name} does not drop its capabilities`);
    assert(
      (service.security_opt ?? []).includes("no-new-privileges:true"),
      `${name} may gain privileges`,
    );
    assert(!service.privileged, `${name} is privileged`);
    assert(typeof service.pids_limit === "number" && service.pids_limit > 0, `${name} has no process limit`);
    assert(service.mem_limit, `${name} has no memory limit`);
    for (const volume of service.volumes ?? []) {
      assert(
        !(volume.source ?? "").includes("docker.sock"),
        `${name} is given Docker itself`,
      );
    }
  }
  // Only the database keeps anything back, and only what its first start
  // needs to prepare the data folder.
  assertEquals(named("db").cap_add, ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID"]);
  for (const [name, service] of Object.entries(services)) {
    if (name === "db") continue;
    assertEquals(service.cap_add ?? [], [], `${name} adds capabilities back`);
  }
});

Deno.test("process limits leave room for the threads these two really start", () => {
  // A0: PostgREST starts one thread per core and died at 100 on a 24-core
  // laptop; the functions runtime starts a fresh worker per request.
  assert((named("rest").pids_limit ?? 0) >= 512, "rest's process limit is too low for a many-core computer");
  assert((named("functions").pids_limit ?? 0) >= 512, "the functions' process limit is too low");
});

Deno.test("everything that can run on a read-only filesystem does", () => {
  for (const name of ["entry", "web", "gateway", "functions", "auth", "rest", "storage", "migrate", "tools", "relay"]) {
    assertEquals(named(name).read_only, true, `${name} may write to its own filesystem`);
  }
  // The database writes its data folder, which is a volume of its own.
  assertEquals(named("db").read_only ?? false, false);
});

Deno.test("the services that stay up come back after a restart; the one-shots do not", () => {
  for (const name of LONG_RUNNING) {
    assertEquals(named(name).restart, "unless-stopped", `${name}'s restart rule`);
  }
  for (const name of ONE_SHOTS) {
    assertEquals(named(name).restart, "no", `${name} would be started again`);
  }
});

Deno.test("sign-ups are closed and a password must be long", () => {
  const auth = named("auth").environment ?? {};
  assertEquals(auth.GOTRUE_DISABLE_SIGNUP, "true");
  assertEquals(auth.GOTRUE_EXTERNAL_PHONE_ENABLED, "false");
  assertEquals(auth.GOTRUE_SMS_AUTOCONFIRM, "false");
  assertEquals(auth.GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED, "false");
  assertEquals(auth.GOTRUE_MAILER_AUTOCONFIRM, "false");
  assertEquals(auth.GOTRUE_PASSWORD_MIN_LENGTH, "15");
  // The page asks for the same number the service enforces.
  assertEquals((named("web").environment ?? {}).SYLOU_MIN_PASSWORD_LENGTH, "15");
});

Deno.test("the data API serves one schema, and storage's S3 endpoint is off", () => {
  assertEquals((named("rest").environment ?? {}).PGRST_DB_SCHEMAS, "public");
  const storage = named("storage").environment ?? {};
  assertEquals(storage.S3_PROTOCOL_ENABLED, "false");
  assertEquals(storage.ENABLE_IMAGE_TRANSFORMATION, "false");
  assertEquals(storage.FILE_SIZE_LIMIT, "10485760");
  for (const key of Object.keys(storage)) {
    assert(!key.startsWith("AWS_"), `storage is given ${key}`);
    assert(!/S3_(ACCESS|SECRET)/.test(key), `storage is given ${key}`);
  }
});

Deno.test("the start order is the one that was measured", () => {
  const dependsOn = (name: string): Record<string, { condition?: string }> =>
    (services[name] as unknown as { depends_on?: Record<string, { condition?: string }> }).depends_on ?? {};
  assertEquals(dependsOn("auth").db?.condition, "service_healthy");
  assertEquals(dependsOn("rest").db?.condition, "service_healthy");
  assertEquals(dependsOn("storage").db?.condition, "service_healthy");
  // Storage needs the data API started before it (A0).
  assertEquals(dependsOn("storage").rest?.condition, "service_started");
  // The migrations wait for sign-in and storage to have run their own.
  assertEquals(dependsOn("migrate").auth?.condition, "service_healthy");
  assertEquals(dependsOn("migrate").storage?.condition, "service_healthy");
  // Nothing that answers a request starts before the migrations are done.
  assertEquals(dependsOn("functions").migrate?.condition, "service_completed_successfully");
  assertEquals(dependsOn("gateway").migrate?.condition, "service_completed_successfully");
  assertEquals(dependsOn("web").gateway?.condition, "service_started");
  assertEquals(dependsOn("entry").web?.condition, "service_started");
});

Deno.test("storage's health check asks the address it actually listens on", () => {
  // Inside that image localhost is ::1, where it does not listen (A0).
  const test = (named("storage").healthcheck ?? {}).test as string[];
  assert(test.some((part) => part.includes("127.0.0.1:5000")), `storage's health check is ${test.join(" ")}`);
  assert(!test.some((part) => part.includes("localhost:5000")));
});

Deno.test("the letter box reads nothing: it has no config of the app's and no secret", () => {
  const entry = named("entry");
  assertEquals(entry.secrets ?? [], []);
  assertEquals(entry.image?.startsWith("nginx/nginx-unprivileged@") || entry.image?.includes("nginx-unprivileged"), true);
  // One mounted file, the stream config, read-only.
  assertEquals((entry.volumes ?? []).length, 1);
  assertEquals((entry.volumes ?? [])[0].target, "/etc/nginx/sylou/entry.conf");
});
