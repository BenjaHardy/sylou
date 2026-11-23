// The live checks: what Sylou Local promises, asked of a running install.
//
// recipe.test.ts reads compose.yaml; these ask the install itself - as a
// browser would, as another website or a stranger's name for this computer
// would, and from inside each container. Each test names the threat-map rows
// it checks.
//
// They make accounts, write, back up, delete and restore, and turn local-only
// mode on and off, so they run only against an install that says it is for
// them: SYLOU_INSTANCE_LABEL=package-test in its config/settings.env. Against
// anything else every test is skipped, so `deno task test` stays as it was
// and an install of yours is never touched.
//
// The install is the one in SYLOU_PACKAGE_DIR (by default this folder), set up
// by the real `./sylou setup`, with the stand-in Ollama (tests/fake-ollama.ts)
// at the OLLAMA_URL of its settings and listening on this computer. The
// catalog check also wants SYLOU_REPLAY_DATABASE_URL: Sylou's migrations
// replayed as CI's database tests replay them (supabase/tests/rls/setup.ts).
//
// Run with: deno task test:package  (from sylou-local/)
import { assert, assertEquals, assertMatch, assertNotEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { LOCAL_ONLY_MODEL_MESSAGE } from "../../supabase/functions/_shared/_local_only.ts";
import { FAKE_MODEL, FAKE_REPLY, FAKE_VERSION, FAKE_WINDOW, type SeenRequest } from "./fake-ollama.ts";

const PACKAGE_DIR = (Deno.env.get("SYLOU_PACKAGE_DIR") ?? fromFileUrl(new URL("../", import.meta.url))).replace(/[\\/]+$/, "");
const LABEL = "package-test";
const IN_CI = Deno.env.get("GITHUB_ACTIONS") === "true";
const FAKE_OLLAMA = Deno.env.get("SYLOU_FAKE_OLLAMA_URL") ?? "http://127.0.0.1:11434";

/** The signing secret Supabase's own example file ships with (T11). */
const DEMO_JWT_SECRET = "your-super-secret-jwt-token-with-at-least-32-characters-long";

/** Every function but config wants a signed-in caller. */
const SIGNED_FUNCTIONS = ["analysis", "chat", "context-prompt", "delete-account", "editor-action", "extract-text", "share-report"];

/** A cloud model the functions know; in local-only mode it is refused by name. */
const CLOUD_MODEL = "claude-sonnet-4-6";

/** One password file per database role (tools/secrets.ts). */
const ROLE_PASSWORDS: Record<string, string> = {
  supabase_admin: "pg_supabase_admin_password",
  postgres: "pg_postgres_password",
  authenticator: "pg_authenticator_password",
  supabase_auth_admin: "pg_auth_admin_password",
  supabase_storage_admin: "pg_storage_admin_password",
};

/** Roles the database image makes that have no password of their own (A0). */
const PASSWORDLESS_ROLES = [
  "pgbouncer",
  "supabase_functions_admin",
  "supabase_replication_admin",
  "supabase_etl_admin",
  "supabase_read_only_user",
  "dashboard_user",
  "anon",
  "authenticated",
  "service_role",
];

/** The long-running services, each with a network namespace of its own. */
const SERVICES = ["entry", "web", "gateway", "functions", "db", "auth", "rest", "storage"];

/** Words written into the install, which must come back from a backup and
 *  must never reach a log. */
const MARKER = `marker-${crypto.randomUUID().slice(0, 8)}`;
/** A web search key pasted into its file, as a person would (T19). */
const PLANTED_KEY = `BSA${crypto.randomUUID().replaceAll("-", "")}`;

// ---------------------------------------------------------------------------
// The install under test
// ---------------------------------------------------------------------------

interface Install {
  dir: string;
  settingsFile: string;
  port: number;
  base: string;
  tag: string;
  project: string;
  backend: string;
  egress: string;
  dbImage: string;
}

function readSettings(file: string): Record<string, string> | undefined {
  let text: string;
  try {
    text = Deno.readTextFileSync(file);
  } catch {
    return undefined;
  }
  // As `docker compose --env-file` reads it.
  const settings: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if (quote === '"' || quote === "'") {
      const end = value.indexOf(quote, 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    settings[match[1]] = value;
  }
  return settings;
}

async function run(command: string, args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  const output = await new Deno.Command(command, {
    args,
    cwd: options.cwd,
    env: options.env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { code: output.code, out: decode(output.stdout), err: decode(output.stderr) };
}

async function findInstall(): Promise<Install | undefined> {
  const settingsFile = join(PACKAGE_DIR, "config", "settings.env");
  const settings = readSettings(settingsFile);
  if (settings?.SYLOU_INSTANCE_LABEL !== LABEL) return undefined;
  const port = Number(settings.SYLOU_PORT || "8080");
  try {
    const answer = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(5000) });
    await answer.body?.cancel();
  } catch {
    return undefined;
  }
  const resolved = await run("docker", [
    "compose",
    "--project-directory",
    PACKAGE_DIR,
    "-f",
    join(PACKAGE_DIR, "compose.yaml"),
    "--env-file",
    settingsFile,
    "config",
    "--format",
    "json",
  ]);
  if (resolved.code !== 0) throw new Error(`docker compose config failed: ${resolved.err}`);
  const config = JSON.parse(resolved.out);
  return {
    dir: PACKAGE_DIR,
    settingsFile,
    port,
    base: `http://localhost:${port}`,
    tag: settings.SYLOU_IMAGE_TAG || "dev",
    project: config.name,
    backend: config.networks.backend.name,
    egress: config.networks.egress.name,
    dbImage: config.services.db.image,
  };
}

const found = await findInstall();
if (!found) {
  console.log(
    `package tests: skipped - no running install in ${PACKAGE_DIR} whose settings say ` +
      `SYLOU_INSTANCE_LABEL=${LABEL} (see the top of tests/package.test.ts)`,
  );
}
// Every test is skipped without one, so inside them it is always there.
const install = found as Install;

/** This install's secret files that hold something, read afresh each time. */
function secrets(): Record<string, string> {
  const folder = join(install.dir, "config", "secrets");
  const values: Record<string, string> = {};
  for (const entry of Deno.readDirSync(folder)) {
    if (!entry.isFile) continue;
    const value = Deno.readTextFileSync(join(folder, entry.name)).trim();
    if (value) values[entry.name] = value;
  }
  return values;
}

// ---------------------------------------------------------------------------
// Reporting: a failure, or a fact worth keeping, as an annotation on the run
// ---------------------------------------------------------------------------

/** An install's secrets never leave in a message: annotations are public. */
function hide(text: string): string {
  let hidden = text.replace(/(token=)[^&\s]+/g, "$1[hidden]");
  if (!found) return hidden;
  for (const value of [...Object.values(secrets()), PLANTED_KEY]) {
    if (value.length >= 8) hidden = hidden.replaceAll(value, "[secret]");
  }
  return hidden;
}

function annotate(level: "error" | "notice", title: string, message: string) {
  const text = hide(message).slice(0, 3500);
  if (!IN_CI) {
    console.log(`${level}: ${title}: ${text}`);
    return;
  }
  const data = (value: string) => value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  const property = (value: string) => data(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
  console.log(`::${level} title=${property(title)}::${data(text)}`);
}

/** Set when a step the later tests stand on has failed. */
let brokenBy: string | undefined;

function live(name: string, fn: () => Promise<void>, options: { step?: boolean } = {}) {
  Deno.test({
    name,
    ignore: !found,
    // These drive Docker and a network; what they leave running is the
    // install, which is the point.
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      if (brokenBy) throw new Error(`not run: "${brokenBy}" failed first`);
      try {
        await fn();
      } catch (error) {
        if (options.step) brokenBy = name;
        annotate("error", name, error instanceof Error ? error.message : String(error));
        throw error;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Talking to the install
// ---------------------------------------------------------------------------

interface Answer {
  status: number;
  headers: Headers;
  bytes: Uint8Array<ArrayBuffer>;
  text: string;
  /** Read loosely: each test checks the fields it needs. */
  // deno-lint-ignore no-explicit-any
  json(): any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** A request through the door, as the app makes one. */
async function http(
  path: string,
  options: {
    method?: string;
    token?: string;
    apikey?: string | null;
    headers?: Record<string, string>;
    json?: unknown;
    body?: BodyInit;
    base?: string;
  } = {},
): Promise<Answer> {
  const headers = new Headers(options.headers);
  const apikey = options.apikey === undefined ? secrets().anon_key : options.apikey;
  if (apikey) headers.set("apikey", apikey);
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  let body = options.body;
  if (options.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(options.json);
  }
  const response = await fetch(new URL(path, options.base ?? install.base), {
    method: options.method ?? (body === undefined ? "GET" : "POST"),
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = new TextDecoder().decode(bytes);
  return { status: response.status, headers: response.headers, bytes, text, json: () => JSON.parse(text) };
}

/** A request written by hand, exactly as given - no client tidies the path or
 *  the name - and whatever comes back before the door closes. */
async function raw(lines: string[], timeoutMs = 5000): Promise<{ text: string; timedOut: boolean }> {
  const connection = await Deno.connect({ hostname: "127.0.0.1", port: install.port });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      connection.close();
    } catch {
      // Already closed.
    }
  }, timeoutMs);
  const chunks: Uint8Array[] = [];
  try {
    await connection.write(new TextEncoder().encode(`${lines.join("\r\n")}\r\n\r\n`));
    const buffer = new Uint8Array(65536);
    while (true) {
      let read: number | null;
      try {
        read = await connection.read(buffer);
      } catch {
        break;
      }
      if (read === null) break;
      chunks.push(buffer.slice(0, read));
    }
  } finally {
    clearTimeout(timer);
    try {
      connection.close();
    } catch {
      // Closed by the door, or by the timer.
    }
  }
  const all = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder().decode(all), timedOut };
}

/** Whether something answers at an address of this computer's own. */
async function connects(hostname: string, port: number, timeoutMs = 3000): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const attempt = Deno.connect({ hostname, port }).then((connection) => {
    connection.close();
    return true;
  }, () => false);
  const timeout = new Promise<boolean>((resolve) => timer = setTimeout(() => resolve(false), timeoutMs));
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function sylou(...args: string[]) {
  return run("sh", [join(install.dir, "sylou"), ...args], { cwd: install.dir });
}

interface Container {
  id: string;
  service: string;
  running: boolean;
  exitCode: number;
  oneOff: boolean;
  /** Network name -> this container's address on it. */
  networks: Record<string, string>;
  /** host address:port of each published port. */
  published: string[];
}

/** The part of `docker inspect` read here. */
interface Inspected {
  Id: string;
  Config: { Labels: Record<string, string> };
  State: { Running: boolean; ExitCode: number };
  NetworkSettings: {
    Networks?: Record<string, { IPAddress: string }>;
    Ports?: Record<string, { HostIp: string; HostPort: string }[] | null>;
  };
}

async function containers(): Promise<Container[]> {
  const ids = (await run("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${install.project}`]))
    .out.split(/\s+/).filter(Boolean);
  if (ids.length === 0) return [];
  const details = JSON.parse((await run("docker", ["inspect", ...ids])).out) as Inspected[];
  return details.map((detail) => ({
    id: detail.Id,
    service: detail.Config.Labels["com.docker.compose.service"],
    running: detail.State.Running,
    exitCode: detail.State.ExitCode,
    oneOff: detail.Config.Labels["com.docker.compose.oneoff"] === "True",
    networks: Object.fromEntries(
      Object.entries(detail.NetworkSettings.Networks ?? {}).map(([name, network]) => [name, network.IPAddress]),
    ),
    published: Object.values(detail.NetworkSettings.Ports ?? {}).flatMap((bindings) =>
      (bindings ?? []).map((binding) => `${binding.HostIp}:${binding.HostPort}`)
    ),
  }));
}

async function service(name: string): Promise<Container> {
  const container = (await containers()).find((each) => each.service === name && each.running && !each.oneOff);
  assert(container, `${name} is not running`);
  return container;
}

/** The functions answer once the runtime is listening; `up --wait` cannot
 *  tell, because they have no health check of their own. */
async function waitForFunctions(seconds = 120) {
  const deadline = Date.now() + seconds * 1000;
  let last = "";
  while (Date.now() < deadline) {
    try {
      const answer = await http("/functions/v1/config");
      if (answer.status === 200) return;
      last = `${answer.status} ${answer.text.slice(0, 120)}`;
    } catch (error) {
      last = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`the functions did not answer within ${seconds} s: ${last}`);
}

interface Target {
  name: string;
  host: string;
  port: number;
}

/** Deno inside the tools image, asking for TCP connections and nothing more.
 *  "reached" or the reason it was not. */
const PROBE = `
const targets = JSON.parse(Deno.args[0]);
const results = {};
await Promise.all(targets.map(async (target) => {
  const timeout = new Promise((resolve) => setTimeout(() => resolve("no answer in 4 s"), 4000));
  const attempt = Deno.connect({ hostname: target.host, port: target.port }).then(
    (connection) => { connection.close(); return "reached"; },
    (error) => String(error && error.message || error).slice(0, 100),
  );
  results[target.name] = await Promise.race([attempt, timeout]);
}));
console.log(JSON.stringify(results));
Deno.exit(0);
`;

/** What can be reached from inside a container (sharing its network, its
 *  name lookups included), or from a fresh one on a network. */
async function probe(where: { container: string } | { network: string }, targets: Target[]) {
  const network = "container" in where ? `container:${where.container}` : where.network;
  const result = await run("docker", [
    "run",
    "--rm",
    "--network",
    network,
    "--entrypoint",
    "deno",
    // Away from the tools' own deno.json, with a cache of its own.
    "-w",
    "/tmp",
    "-e",
    "DENO_DIR=/tmp/deno",
    `ghcr.io/benjahardy/sylou-tools:${install.tag}`,
    "eval",
    PROBE,
    JSON.stringify(targets),
  ]);
  assertEquals(result.code, 0, `the probe did not run: ${result.err}`);
  return JSON.parse(result.out.trim().split("\n").pop() ?? "{}") as Record<string, string>;
}

/** psql, in the database's own image, on the inside network as postgres. */
async function sql(query: string): Promise<string> {
  const result = await run("docker", [
    "run",
    "--rm",
    "--network",
    install.backend,
    "-e",
    "PGPASSWORD",
    "--entrypoint",
    "psql",
    install.dbImage,
    "-X",
    "-w",
    "-q",
    "-tA",
    "-h",
    "db",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-c",
    query,
  ], { env: { PGPASSWORD: secrets().pg_postgres_password } });
  assertEquals(result.code, 0, `psql: ${result.err}`);
  return result.out.trim();
}

/** The address of this computer on Docker's own bridge: where a container
 *  that has a way out finds the computer, and the stand-in Ollama with it. */
async function computerAddress(): Promise<string> {
  const result = await run("docker", ["network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}"]);
  return result.out.trim();
}

async function fakeOllamaRequests(): Promise<SeenRequest[]> {
  return await (await fetch(`${FAKE_OLLAMA}/__fake/requests`)).json();
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** An HS256 token, signed with whatever secret it is given. */
async function sign(payload: Record<string, unknown>, secret: string): Promise<string> {
  const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return `${unsigned}.${base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(unsigned))))}`;
}

// ---------------------------------------------------------------------------
// Files to import: a PDF and a Word document, made here
// ---------------------------------------------------------------------------

const PDF_TYPE = "application/pdf";
const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function pdf(text: string): Uint8Array<ArrayBuffer> {
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A ZIP that stores its files as they are: enough for a .docx. */
function zip(files: [string, string][]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = new TextEncoder().encode(content);
    const fileName = new TextEncoder().encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, fileName.length, true);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, fileName.length, true);
    entry.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), fileName, data);
    central.push(new Uint8Array(entry.buffer), fileName);
    offset += 30 + fileName.length + data.length;
  }
  const centralSize = central.reduce((length, part) => length + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((length, part) => length + part.length, 0));
  let at = 0;
  for (const part of all) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function docx(text: string): Uint8Array<ArrayBuffer> {
  return zip([
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ],
    [
      "word/document.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
    ],
  ]);
}

// ---------------------------------------------------------------------------
// Accounts, made as a person makes them: add-user, then its one-time link
// ---------------------------------------------------------------------------

interface Account {
  email: string;
  password: string;
  id: string;
  access: string;
  refresh: string;
}

async function signIn(email: string, password: string) {
  const answer = await http("/auth/v1/token?grant_type=password", { json: { email, password } });
  assertEquals(answer.status, 200, `${email} could not sign in: ${answer.text}`);
  const body = answer.json();
  return { id: body.user.id as string, access: body.access_token as string, refresh: body.refresh_token as string };
}

async function account(email: string): Promise<Account> {
  const made = await sylou("add-user", email);
  assertEquals(made.code, 0, hide(made.out + made.err));
  const link = /(https?:\/\/\S+\/auth\/v1\/verify\?\S+)/.exec(made.out)?.[1];
  assert(link, `add-user printed no link: ${hide(made.out)}`);

  const opened = await fetch(link, { redirect: "manual" });
  await opened.body?.cancel();
  const landing = opened.headers.get("location") ?? "";
  assert(
    landing.startsWith(`${install.base}/auth/set-password#`),
    `the link led to ${landing.split("#")[0] || `nothing (${opened.status})`}`,
  );
  const recovery = new URLSearchParams(landing.split("#")[1]).get("access_token");
  assert(recovery, "the link opened no session");

  // Used once, it is spent.
  const again = await fetch(link, { redirect: "manual" });
  await again.body?.cancel();
  assert(!(again.headers.get("location") ?? "").includes("access_token="), "the one-time link worked twice");

  // T23: the sign-in service holds the floor the page asks for.
  const short = await http("/auth/v1/user", { method: "PUT", token: recovery, json: { password: "fourteen-chars" } });
  assertEquals(short.status, 422, `a 14-character password: ${short.text}`);
  assertEquals(short.json().error_code, "weak_password", short.text);

  const password = `pt-${crypto.randomUUID()}`;
  const set = await http("/auth/v1/user", { method: "PUT", token: recovery, json: { password } });
  assertEquals(set.status, 200, set.text);
  return { email, password, ...(await signIn(email, password)) };
}

async function upload(who: Account, path: string, bytes: Uint8Array<ArrayBuffer>, type: string): Promise<Answer> {
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", new Blob([bytes], { type }), path.split("/").pop());
  return await http(`/storage/v1/object/imports/${path}`, { token: who.access, body: form });
}

async function importDocument(who: Account, project: string, name: string, bytes: Uint8Array<ArrayBuffer>, type: string) {
  const path = `${who.id}/${project}/${name}`;
  const stored = await upload(who, path, bytes, type);
  assertEquals(stored.status, 200, `upload of ${name}: ${stored.text}`);
  const row = await http("/rest/v1/imported_documents?select=id", {
    token: who.access,
    headers: { prefer: "return=representation", accept: "application/vnd.pgrst.object+json" },
    json: { project_id: project, file_name: name, file_path: path, file_size_bytes: bytes.length },
  });
  assertEquals(row.status, 201, `row for ${name}: ${row.text}`);
  return { path, id: row.json().id as string };
}

function editorAction(who: Account, project: string, model: string) {
  return http("/functions/v1/editor-action", {
    token: who.access,
    json: { project_id: project, action_type: "fix_grammar", selected_text: `Helo wrld, ${MARKER}`, model },
  });
}

/** Every container's log, the one-shots that are left included. */
async function logs(): Promise<string> {
  let all = "";
  for (const container of await containers()) {
    const result = await run("docker", ["logs", container.id]);
    all += `\n${container.service}:\n${result.out}${result.err}`;
  }
  return all;
}

async function assertNothingInLogs() {
  const text = await logs();
  const leaked = Object.entries(secrets()).filter(([, value]) => value.length >= 8 && text.includes(value)).map(([name]) => name);
  assertEquals(leaked, [], `in the containers' logs: ${leaked.join(", ")}`);
  assert(!text.includes(PLANTED_KEY), "the web search key is in a container's log");
  assert(!text.includes(MARKER), "text written in Sylou is in a container's log");
}

// ---------------------------------------------------------------------------
// The door (T1-T5, T10, T32)
// ---------------------------------------------------------------------------

live("the door: one published port, the letter box's, on 127.0.0.1 alone (T1)", async () => {
  const publishing = (await containers()).filter((container) => container.published.length > 0);
  assertEquals(publishing.map((container) => `${container.service} ${container.published.join(" ")}`), [
    `entry 127.0.0.1:${install.port}`,
  ]);

  // What this computer listens on, where it can say.
  const listening = await run("ss", ["-ltnH"]).catch(() => undefined);
  if (listening?.code === 0) {
    const ours = listening.out.split("\n").map((line) => line.trim().split(/\s+/)[3]).filter((address) =>
      address?.endsWith(`:${install.port}`)
    );
    assertEquals(ours, [`127.0.0.1:${install.port}`], "listeners on Sylou's port");
  }

  // And nothing answers at this computer's other addresses.
  for (const nic of Deno.networkInterfaces()) {
    if (nic.address.startsWith("127.") || nic.address === "::1" || nic.address.startsWith("fe80:")) continue;
    assertEquals(await connects(nic.address, install.port), false, `Sylou answered at ${nic.address}:${install.port}`);
  }
});

live("the door: a name that is not this computer's gets the connection closed, and nothing else (T3)", async () => {
  for (const host of ["attacker.example", `attacker.example:${install.port}`, `localhost.attacker.example:${install.port}`]) {
    const answer = await raw(["GET / HTTP/1.1", `Host: ${host}`, "Connection: close"]);
    assertEquals(answer.text, "", `Host ${host} was answered: ${answer.text.split("\r\n")[0]}`);
    assert(!answer.timedOut, `Host ${host}: the connection was left open`);
  }
  const nameless = await raw(["GET / HTTP/1.0"]);
  assertEquals(nameless.text, "", "a request with no name was answered");
});

live("the door: 127.0.0.1 is sent on to localhost, with its path and query (T1, T3)", async () => {
  const answer = await fetch(`http://127.0.0.1:${install.port}/report/x?y=1`, { redirect: "manual" });
  await answer.body?.cancel();
  assertEquals(answer.status, 308);
  assertEquals(answer.headers.get("location"), `${install.base}/report/x?y=1`);
});

live("the door: no cross-site answer from any API path, whatever the services say (T2)", async () => {
  const paths = ["/auth/v1/settings", "/rest/v1/projects?select=id", "/storage/v1/object/imports/x", "/functions/v1/config", "/functions/v1/chat"];
  for (const path of paths) {
    for (const method of ["GET", "OPTIONS"]) {
      const answer = await http(path, {
        method,
        headers: {
          origin: "https://attacker.example",
          "access-control-request-method": "POST",
          "access-control-request-headers": "authorization, content-type",
        },
      });
      const cors = [...answer.headers.keys()].filter((name) => name.startsWith("access-control-"));
      assertEquals(cors, [], `${method} ${path} (${answer.status}) answered with ${cors.join(", ")}`);
    }
  }
});

live("the door: the browser's security headers, on a page, a report, an asset and the run-time file (T4, T10)", async () => {
  const headersConf = Deno.readTextFileSync(join(install.dir, "web", "headers.conf"));
  const policy = /add_header Content-Security-Policy "([^"]+)" always;/.exec(headersConf)?.[1];
  assert(policy, "no Content-Security-Policy in web/headers.conf");

  const page = await http("/", { apikey: null });
  const asset = /\/assets\/[^"']+\.js/.exec(page.text)?.[0];
  assert(asset, "the page names no script under /assets/");
  for (const path of ["/", "/report/x", asset, "/sylou-runtime.js"]) {
    const answer = path === "/" ? page : await http(path, { apikey: null });
    assertEquals(answer.status, 200, path);
    assertEquals(answer.headers.get("content-security-policy"), policy, path);
    assertEquals(answer.headers.get("x-content-type-options"), "nosniff", path);
    assertEquals(answer.headers.get("x-frame-options"), "DENY", path);
  }
  // A report page keeps the two it adds: A0 saw them lost to an internal
  // redirect, which only a live request shows.
  const report = await http("/report/x", { apikey: null });
  assertEquals(report.headers.get("x-robots-tag"), "noindex");
  assertEquals(report.headers.get("referrer-policy"), "no-referrer");
  assertStringIncludes((await http(asset, { apikey: null })).headers.get("cache-control") ?? "", "immutable");
  assertEquals((await http("/sylou-runtime.js", { apikey: null })).headers.get("cache-control"), "no-store");
});

/** Paths written as a person trying their luck would write them. */
const NEVER_FORWARDED: [string, string][] = [
  ["GET", "/auth/v1/admin/users"],
  ["POST", "/auth/v1/admin/generate_link"],
  ["GET", "/auth/v1//admin/users"],
  ["GET", "/auth/v1/%61dmin/users"],
  ["GET", "/auth/v1/x/../admin/users"],
  ["GET", "/auth/v1/admin%2Fusers"],
  ["GET", "/storage/v1/s3"],
  ["GET", "/storage/v1/bucket"],
  ["GET", "/storage/v1/render/image/public/imports/x.png"],
  ["GET", "/pg/tables"],
  ["GET", "/studio"],
  ["GET", "/realtime/v1/websocket"],
  ["GET", "/analytics/v1/x"],
  ["GET", "/graphql/v1"],
  ["GET", "/functions/v1/unknown"],
  ["GET", "/functions/v1/main"],
];

live("the door: the admin API, storage's S3, other services' pages and unknown functions answer 404 (T5, T13, T24, T32)", async () => {
  for (const [method, path] of NEVER_FORWARDED) {
    const answer = await raw([`${method} ${path} HTTP/1.1`, `Host: localhost:${install.port}`, "Content-Length: 0", "Connection: close"]);
    const status = /^HTTP\/1\.[01] (\d{3})/.exec(answer.text)?.[1];
    assertEquals(status, "404", `${method} ${path}: ${answer.text.split("\r\n")[0] || "no answer"}`);
  }
});

// ---------------------------------------------------------------------------
// Sign-in (T11-T13, T22, T23)
// ---------------------------------------------------------------------------

live("sign-in: sign-up of every kind is refused, and makes no account (T22)", async () => {
  const stranger = `stranger-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const attempts: { what: string; path: string; json: unknown; codes?: string[] }[] = [
    { what: "email sign-up", path: "/auth/v1/signup", json: { email: stranger, password: "a-long-enough-password-1" }, codes: ["signup_disabled"] },
    {
      what: "phone sign-up",
      path: "/auth/v1/signup",
      json: { phone: "+15555550123", password: "a-long-enough-password-1" },
      codes: ["signup_disabled", "phone_provider_disabled"],
    },
    { what: "anonymous sign-in", path: "/auth/v1/signup", json: {}, codes: ["anonymous_provider_disabled", "signup_disabled"] },
    { what: "a sign-in link that would make an account", path: "/auth/v1/otp", json: { email: stranger, create_user: true } },
  ];
  for (const attempt of attempts) {
    const answer = await http(attempt.path, { json: attempt.json });
    assert(answer.status >= 400 && answer.status < 500, `${attempt.what}: ${answer.status} ${answer.text}`);
    if (attempt.codes) assert(attempt.codes.includes(answer.json().error_code), `${attempt.what}: ${answer.text}`);
  }
  assertEquals(await sql(`select count(*) from auth.users where email = '${stranger}' or phone like '%5555550123'`), "0");
});

live("sign-in: a token signed with Supabase's demo secret opens nothing (T11)", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (const role of ["anon", "authenticated", "service_role"]) {
    const token = await sign({
      role,
      iss: "supabase-demo",
      ...(role === "authenticated" ? { sub: crypto.randomUUID(), aud: "authenticated" } : {}),
      iat: now,
      exp: now + 3600,
    }, DEMO_JWT_SECRET);
    const data = await http("/rest/v1/projects?select=id", { apikey: token, token });
    assertEquals(data.status, 401, `the data API took the ${role} token: ${data.text}`);
    const user = await http("/auth/v1/user", { apikey: token, token });
    assert(user.status === 401 || user.status === 403, `sign-in took the ${role} token: ${user.status} ${user.text}`);
    const files = await http("/storage/v1/object/list/imports", { apikey: token, token, json: { prefix: "" } });
    assert(files.status >= 400, `storage took the ${role} token: ${files.status} ${files.text}`);
    const report = await http("/functions/v1/share-report", { apikey: token, token, json: {} });
    assertEquals(report.status, 401, `a function took the ${role} token: ${report.text}`);
  }
});

live("the functions: each but config refuses an unsigned call, and config answers (T12, T13)", async () => {
  await waitForFunctions();
  for (const name of SIGNED_FUNCTIONS) {
    const answer = await http(`/functions/v1/${name}`, { json: {} });
    assertEquals(answer.status, 401, `${name}: ${answer.text}`);
  }
  const config = await http("/functions/v1/config");
  assertEquals(config.status, 200, config.text);
  assertEquals(config.json().local_only, undefined);
  assertEquals(config.json().local_models, undefined, "a caller who is not signed in was told about the local models");
});

live("settings: a key pasted into its file reaches the functions once they start again", async () => {
  Deno.writeTextFileSync(join(install.dir, "config", "secrets", "brave_search_api_key"), PLANTED_KEY);
  // What settings.example.env says to do: paste it, then `sylou start` again.
  assertEquals((await sylou("start")).code, 0);
  await waitForFunctions();
  assertEquals((await http("/functions/v1/config")).json().web_search_enabled, true, "`start` did not hand the functions the key");
  // And from a stopped install, where `start` makes every container anew.
  assertEquals((await sylou("stop")).code, 0);
  assertEquals((await sylou("start")).code, 0);
  await waitForFunctions();
  assertEquals((await http("/functions/v1/config")).json().web_search_enabled, true, "the functions lost the key after `stop` and `start`");
}, { step: true });

let alice: Account;
let bob: Account;
let project: string;
let pdfBytes: Uint8Array<ArrayBuffer>;
let pdfPath: string;

live("accounts: add-user's one-time link sets a password once, and a short one is refused (T23, T24)", async () => {
  alice = await account("alice@example.com");
  bob = await account("bob@example.com");
}, { step: true });

// ---------------------------------------------------------------------------
// The database (T25-T28)
// ---------------------------------------------------------------------------

live("the database: nothing on this computer can reach it (T25)", async () => {
  assertEquals(await connects("127.0.0.1", 5432), false, "something answers on 127.0.0.1:5432");
  for (const [network, address] of Object.entries((await service("db")).networks)) {
    assertEquals(await connects(address, 5432), false, `the database answered this computer on ${network} (${address})`);
  }
});

live("the database: each role takes its own password and no other, and none takes the demo one (T26)", async () => {
  const values = Object.values(ROLE_PASSWORDS).map((file) => secrets()[file]);
  assert(values.every(Boolean), "a role's password file is empty");
  assertEquals(new Set(values).size, values.length, "two database roles share a password");

  const lines = [
    "try() {",
    "  if PGPASSWORD=\"$3\" psql -X -w -h db -U \"$1\" -d postgres -tAc 'select 1' >/dev/null 2>&1; then r=accepted; else r=refused; fi",
    "  printf '%s|%s|%s\\n' \"$1\" \"$2\" \"$r\"",
    "}",
    "try postgres postgres postgres",
  ];
  for (const role of Object.keys(ROLE_PASSWORDS)) {
    for (const file of Object.values(ROLE_PASSWORDS)) lines.push(`try ${role} ${file} "$(cat /secrets/${file})"`);
  }
  for (const role of PASSWORDLESS_ROLES) lines.push(`try ${role} empty ''`, `try ${role} postgres postgres`);
  const result = await run("docker", [
    "run",
    "--rm",
    "--network",
    install.backend,
    "-v",
    `${join(install.dir, "config", "secrets")}:/secrets:ro`,
    "--entrypoint",
    "bash",
    install.dbImage,
    "-c",
    lines.join("\n"),
  ]);
  assertEquals(result.code, 0, result.err);
  const wrong: string[] = [];
  for (const line of result.out.trim().split("\n")) {
    const [role, password, outcome] = line.split("|");
    const expected = ROLE_PASSWORDS[role] === password ? "accepted" : "refused";
    if (outcome !== expected) wrong.push(`${role} with ${password === "postgres" || password === "empty" ? `"${password}"` : password}: ${outcome}`);
  }
  assertEquals(wrong, []);
});

/** The catalog as psql prints it, by section. */
function catalogLines(text: string, leaveOut?: (section: string, line: string) => boolean): string[] {
  const lines: string[] = [];
  let section = "";
  for (const line of text.split("\n").map((each) => each.trimEnd()).filter(Boolean)) {
    if (line.startsWith("## ")) section = line;
    if (leaveOut?.(section, line)) continue;
    lines.push(line);
  }
  return lines;
}

live("the database: grants, policies, RLS and owners are those of the migrations replayed in CI (T27)", async () => {
  const replay = Deno.env.get("SYLOU_REPLAY_DATABASE_URL");
  if (!replay) {
    annotate("notice", "Catalog check", "skipped: SYLOU_REPLAY_DATABASE_URL is not set");
    return;
  }
  const query = `${join(install.dir, "tests", "catalog.sql")}:/catalog.sql:ro`;
  const catalogOf = async (network: string, env: Record<string, string>) => {
    const result = await run("docker", [
      "run",
      "--rm",
      "--network",
      network,
      ...Object.keys(env).flatMap((name) => ["-e", name]),
      "-v",
      query,
      "--entrypoint",
      "psql",
      install.dbImage,
      "-X",
      "-w",
      "-q",
      "-f",
      "/catalog.sql",
    ], { env });
    assertEquals(result.code, 0, `the catalog query failed: ${result.err}`);
    return result.out;
  };
  const url = new URL(replay);
  const ours = await catalogOf(install.backend, {
    PGHOST: "db",
    PGUSER: "postgres",
    PGDATABASE: "postgres",
    PGPASSWORD: secrets().pg_postgres_password,
  });
  const theirs = await catalogOf("host", {
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: url.pathname.slice(1),
  });
  // The one difference A0 found: supabase_admin's own default privileges,
  // which reach nothing because nothing of Sylou's is made by that role.
  const adminDefaults = (section: string, line: string) =>
    section.startsWith("## default privileges") && line.startsWith("supabase_admin | ");
  const package_ = catalogLines(ours, adminDefaults);
  const replayed = catalogLines(theirs);
  assert(replayed.length > 50, `the replay's catalog is nearly empty (${replayed.length} lines)`);
  assertEquals(package_, replayed);
  annotate("notice", "Catalog check", `${replayed.length} lines identical to the CI replay`);
});

live("the database: two users are kept apart through the door (T27)", async () => {
  const made = await http("/rest/v1/projects?select=id", {
    token: alice.access,
    headers: { prefer: "return=representation", accept: "application/vnd.pgrst.object+json" },
    json: { name: "Kept apart", user_id: alice.id },
  });
  assertEquals(made.status, 201, made.text);
  project = made.json().id;
  // The project's writing row is made with the project, by a trigger; the
  // app saves into it, as here.
  const writing = await http(`/rest/v1/writing_content?project_id=eq.${project}`, {
    method: "PATCH",
    token: alice.access,
    headers: { prefer: "return=representation" },
    json: { content: `<p>Written before the backup: ${MARKER}</p>` },
  });
  assertEquals(writing.status, 200, writing.text);
  assertEquals(writing.json().length, 1, writing.text);
  pdfBytes = pdf(`Sylou package test ${MARKER}`);
  pdfPath = (await importDocument(alice, project, "round-trip.pdf", pdfBytes, PDF_TYPE)).path;

  // Bob sees none of it, and can change none of it.
  assertEquals((await http("/rest/v1/projects?select=id", { token: bob.access })).json(), []);
  assertEquals((await http(`/rest/v1/writing_content?project_id=eq.${project}&select=id`, { token: bob.access })).json(), []);
  assertEquals((await http(`/rest/v1/imported_documents?project_id=eq.${project}&select=id`, { token: bob.access })).json(), []);
  const renamed = await http(`/rest/v1/projects?id=eq.${project}`, {
    method: "PATCH",
    token: bob.access,
    headers: { prefer: "return=representation" },
    json: { name: "Taken" },
  });
  assertEquals(renamed.json(), [], `Bob renamed Alice's project: ${renamed.text}`);
  const read = await http(`/storage/v1/object/imports/${pdfPath}`, { token: bob.access });
  assert(read.status >= 400, `Bob downloaded Alice's file: ${read.status}`);
  const planted = await upload(bob, `${alice.id}/${project}/planted.pdf`, pdf("planted"), PDF_TYPE);
  assert(planted.status >= 400, `Bob wrote into Alice's folder: ${planted.status} ${planted.text}`);
}, { step: true });

live("the database: a fresh install has every migration, applied once (T28, T49)", async () => {
  const files = [...Deno.readDirSync(join(install.dir, "..", "supabase", "migrations"))].filter((entry) => entry.name.endsWith(".sql"));
  assertEquals(await sql("select count(*) from sylou_local.migrations"), String(files.length));
  const migrate = (await containers()).find((container) => container.service === "migrate");
  assert(migrate && !migrate.running && migrate.exitCode === 0, "the migrations one-shot did not finish cleanly");
});

// ---------------------------------------------------------------------------
// doctor, and the route to a model on this computer
// ---------------------------------------------------------------------------

live("doctor: a report on this install, Ollama's version on its line, no secret in it (T40, T45)", async () => {
  const { out } = await sylou("doctor");
  assertStringIncludes(out, "Sylou doctor");
  assertMatch(out, new RegExp(`\\[ ok \\] Ollama +version ${FAKE_VERSION.replaceAll(".", "\\.")}`));
  assertMatch(out, /The database +answering, \d+ migrations applied/);
  assertStringIncludes(out, "safe to paste");
  for (const [name, value] of Object.entries(secrets())) assert(!out.includes(value), `doctor printed ${name}`);
});

live("local models: the functions reach Ollama on this computer and use its model", async () => {
  const config = await http("/functions/v1/config", { token: alice.access });
  assertEquals(config.json().local_models, [{ id: `ollama/${FAKE_MODEL}`, name: FAKE_MODEL, context_tokens: FAKE_WINDOW, tools: true }]);
  const edited = await editorAction(alice, project, `ollama/${FAKE_MODEL}`);
  assertEquals(edited.status, 200, edited.text);
  assertEquals(edited.json().proposed_text, FAKE_REPLY);
  const asked = (await fakeOllamaRequests()).filter((request) => request.path === "/v1/chat/completions").at(-1);
  const functions = await service("functions");
  assert(asked && Object.values(functions.networks).includes(asked.from), `the model was asked from ${asked?.from}`);
});

// ---------------------------------------------------------------------------
// The API's answers (T63)
// ---------------------------------------------------------------------------

live("the door: answers from the data API, storage and the functions are sandboxed, errors included, and the app's requests and streams still work (T63)", async () => {
  const conf = Deno.readTextFileSync(join(install.dir, "web", "api-headers.conf"));
  const expected = [...conf.matchAll(/^\s*add_header\s+(\S+)\s+"([^"]+)"\s+always;\s*$/gm)].map((match) => [match[1], match[2]]);
  assert(
    expected.some(([name, value]) => name === "Content-Security-Policy" && value.split(";").map((part) => part.trim()).includes("sandbox")),
    "no sandbox policy in web/api-headers.conf",
  );

  // What the app asks for, answered as before.
  const projects = await http("/rest/v1/projects?select=id", { token: alice.access });
  assertEquals(projects.json(), [{ id: project }], projects.text);
  const file = await http(`/storage/v1/object/imports/${pdfPath}`, { token: alice.access });
  assertEquals(file.status, 200, file.text.slice(0, 200));
  assertStringIncludes(file.headers.get("content-type") ?? "", PDF_TYPE);
  assertEquals(await sha256(file.bytes), await sha256(pdfBytes), "the stored file came back changed");
  const config = await http("/functions/v1/config", { token: alice.access });
  assertEquals(config.status, 200, config.text);

  // A stream, read as the app reads one: token by token, then the result.
  const streamed = await http("/functions/v1/editor-action", {
    token: alice.access,
    json: { project_id: project, action_type: "fix_grammar", selected_text: `Helo wrld, ${MARKER}`, model: `ollama/${FAKE_MODEL}`, stream: true },
  });
  assertEquals(streamed.status, 200, streamed.text);
  assertStringIncludes(streamed.headers.get("content-type") ?? "", "text/event-stream");
  const events = streamed.text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
  assertEquals(events.map((event) => event.token ?? "").join(""), FAKE_REPLY, streamed.text);
  const done = events.find((event) => event.done === true);
  assertEquals([done?.result, done?.error], [FAKE_REPLY, undefined], streamed.text);

  // And what the services refuse.
  const refused = await http("/rest/v1/projects?select=id", { token: "not-a-token" });
  assertEquals(refused.status, 401, refused.text);
  const missing = await http(`/storage/v1/object/imports/${alice.id}/${project}/missing.pdf`, { token: alice.access });
  assert(missing.status >= 400, `a file that is not there: ${missing.status}`);
  const unsigned = await http("/functions/v1/chat", { json: {} });
  assertEquals(unsigned.status, 401, unsigned.text);

  const answers: [string, Answer][] = [
    ["a data read", projects],
    ["a stored file", file],
    ["a function's answer", config],
    ["an editor action's stream", streamed],
    ["a refused data read", refused],
    ["a file that is not there", missing],
    ["an unsigned function call", unsigned],
  ];
  for (const [what, answer] of answers) {
    for (const [name, value] of expected) assertEquals(answer.headers.get(name), value, `${what}: ${name}`);
  }

  // The sign-in service's answers are left as Supabase leaves them.
  const settings = await http("/auth/v1/settings");
  assertEquals(settings.status, 200, settings.text);
  assert(!(settings.headers.get("content-security-policy") ?? "").includes("sandbox"), "sign-in's answers are sandboxed");
});

// ---------------------------------------------------------------------------
// Containment (T19, T36)
// ---------------------------------------------------------------------------

live("containment: the inside network reaches neither the internet nor this computer (T36)", async () => {
  const computer = await computerAddress();
  const results = await probe({ network: install.backend }, [
    { name: "the database, on the same network", host: "db", port: 5432 },
    { name: "the internet, by address", host: "1.1.1.1", port: 443 },
    { name: "the internet, by name", host: "github.com", port: 443 },
    { name: "this computer, where Ollama listens", host: computer, port: 11434 },
  ]);
  // A probe that reaches nothing proves nothing: it must reach its neighbour.
  assertEquals(results["the database, on the same network"], "reached", JSON.stringify(results));
  for (const [name, result] of Object.entries(results)) {
    if (name.startsWith("the database")) continue;
    assertNotEquals(result, "reached", `the inside network reached ${name}`);
  }
});

live("containment: on Linux nothing but the functions reaches the internet, the letter box included (T36)", async () => {
  if (Deno.build.os !== "linux") {
    annotate("notice", "Containment", "the letter box's own network keeps no way out on a Linux engine only");
    return;
  }
  const reached: string[] = [];
  for (const name of SERVICES) {
    const results = await probe({ container: (await service(name)).id }, [{ name: "internet", host: "1.1.1.1", port: 443 }]);
    if (results.internet === "reached") reached.push(name);
  }
  assertEquals(reached, ["functions"]);
});

live("logs: no install secret, pasted key or written text in any container's log (T19)", async () => {
  await assertNothingInLogs();
});

// ---------------------------------------------------------------------------
// Data (T28, T30, T33, T49)
// ---------------------------------------------------------------------------

live("data: backup, remove, a fresh setup and restore bring back the writing and an imported file, byte for byte; a restore that cannot finish changes nothing (T30, T33, T49)", async () => {
  const folder = await Deno.makeTempDir({ prefix: "sylou-package-backup-" });
  const backup = await sylou("backup", folder);
  assertEquals(backup.code, 0, hide(backup.out + backup.err));
  const made = [...Deno.readDirSync(folder)];
  assertEquals(made.length, 1, "backup did not make one folder");
  const into = join(folder, made[0].name);
  for (const name of ["data.sql", "files.tar", "manifest.txt"]) {
    assert(Deno.statSync(join(into, name)).isFile, `the backup has no ${name}`);
  }
  const dump = Deno.readTextFileSync(join(into, "data.sql"));
  for (const [name, value] of Object.entries(secrets())) assert(!dump.includes(value), `${name} is in the backup`);
  assertStringIncludes(dump, MARKER);

  // This install has accounts, so the backup cannot go back into it, and
  // nothing is changed.
  const refused = await sylou("restore", into, "--yes");
  assertEquals(refused.code, 1, hide(refused.out + refused.err));
  assertStringIncludes(refused.out + refused.err, "already has accounts");
  assertStringIncludes(refused.out + refused.err, "setup without an email");
  const kept = await http(`/rest/v1/writing_content?project_id=eq.${project}&select=content`, { token: alice.access });
  assertEquals(kept.json(), [{ content: `<p>Written before the backup: ${MARKER}</p>` }]);

  const removed = await sylou("remove", "--yes");
  assertEquals(removed.code, 0, hide(removed.out + removed.err));
  assertEquals((await containers()).length, 0, "remove left containers behind");
  const volumes = await run("docker", ["volume", "ls", "-q", "--filter", `label=com.docker.compose.project=${install.project}`]);
  assertEquals(volumes.out.trim(), "", "remove left the data behind");

  // A fresh install in the same folder, with no account: the backup brings them.
  const setup = await sylou("setup");
  assertEquals(setup.code, 0, hide(setup.out + setup.err));
  await waitForFunctions();
  const empty = await http("/auth/v1/token?grant_type=password", { json: { email: alice.email, password: alice.password } });
  assertEquals(empty.status, 400, "an account was there before the restore");

  // A restore that stops keeps nothing: the same dump, made to fail at its
  // very end, after every table in it was read. The folder is readable by the
  // restore's one-shot, as a backup's own folder is.
  const broken = await Deno.makeTempDir({ prefix: "sylou-package-broken-" });
  if (Deno.build.os !== "windows") Deno.chmodSync(broken, 0o755);
  assertMatch(dump, /RESET ALL;\s*$/);
  Deno.writeTextFileSync(join(broken, "data.sql"), dump.replace(/RESET ALL;\s*$/, "SELECT 1/0;\nRESET ALL;\n"));
  const stopped = await sylou("restore", broken, "--yes");
  Deno.removeSync(broken, { recursive: true });
  assertEquals(stopped.code, 1, hide(stopped.out + stopped.err));
  assertStringIncludes(stopped.out + stopped.err, "nothing of the dump was kept");
  const none = await http("/auth/v1/token?grant_type=password", { json: { email: alice.email, password: alice.password } });
  assertEquals(none.status, 400, "a restore that stopped kept the accounts it had loaded");

  const restored = await sylou("restore", into, "--yes");
  assertEquals(restored.code, 0, hide(restored.out + restored.err));

  // The password still works; the session from before does not.
  const back = await signIn(alice.email, alice.password);
  const stale = await http("/auth/v1/token?grant_type=refresh_token", { json: { refresh_token: alice.refresh } });
  assertEquals(stale.status, 400, `the old refresh token still works: ${stale.text}`);
  const oldSession = await http("/auth/v1/user", { token: alice.access });
  assert(oldSession.status === 401 || oldSession.status === 403, `the old session still opens the account: ${oldSession.status}`);
  alice = { ...alice, ...back };
  bob = { ...bob, ...(await signIn(bob.email, bob.password)) };

  const writing = await http(`/rest/v1/writing_content?project_id=eq.${project}&select=content`, { token: alice.access });
  assertEquals(writing.json(), [{ content: `<p>Written before the backup: ${MARKER}</p>` }]);
  const file = await http(`/storage/v1/object/imports/${pdfPath}`, { token: alice.access });
  assertEquals(file.status, 200, `the imported file did not come back: ${file.text.slice(0, 200)}`);
  assertEquals(await sha256(file.bytes), await sha256(pdfBytes), "the imported file came back changed");
  assertEquals((await http(`/rest/v1/imported_documents?project_id=eq.${project}&select=file_path`, { token: alice.access })).json(), [
    { file_path: pdfPath },
  ]);
  // And the two are still kept apart.
  assertEquals((await http("/rest/v1/projects?select=id", { token: bob.access })).json(), []);
}, { step: true });

// ---------------------------------------------------------------------------
// Local-only mode (T59, T60)
// ---------------------------------------------------------------------------

live("local-only: on, the functions lose their way out and keep one route, through the relay (T60)", async () => {
  const on = await sylou("local-only", "on");
  assertEquals(on.code, 0, hide(on.out + on.err));
  await waitForFunctions();
  assertEquals(Object.keys((await service("functions")).networks), [install.backend]);
  await service("relay");
}, { step: true });

live("local-only: a cloud model is refused by name, and the local model answers through the relay (T60)", async () => {
  const config = await http("/functions/v1/config", { token: alice.access });
  assertEquals(config.json().local_only, true);
  assertEquals(config.json().web_search_enabled, false, "web search is on in local-only mode");
  assertEquals(config.json().local_models?.[0]?.context_tokens, FAKE_WINDOW, config.text);

  const cloud = await editorAction(alice, project, CLOUD_MODEL);
  assertEquals(cloud.status, 500, cloud.text);
  assertEquals(cloud.json().error, LOCAL_ONLY_MODEL_MESSAGE);

  const local = await editorAction(alice, project, `ollama/${FAKE_MODEL}`);
  assertEquals(local.status, 200, local.text);
  assertEquals(local.json().proposed_text, FAKE_REPLY);
  const asked = (await fakeOllamaRequests()).filter((request) => request.path === "/v1/chat/completions").at(-1);
  const relay = await service("relay");
  assert(asked && Object.values(relay.networks).includes(asked.from), `the model was asked from ${asked?.from}, not the relay`);
});

live("local-only: every function starts and answers with no network (T59)", async () => {
  for (const name of SIGNED_FUNCTIONS) {
    const answer = await http(`/functions/v1/${name}`, { json: {} });
    assertEquals(answer.status, 401, `${name}: ${answer.text}`);
  }
});

live("local-only: a PDF and a Word file are imported with no network (T59)", async () => {
  const files: [string, Uint8Array<ArrayBuffer>, string][] = [
    ["offline.pdf", pdf(`Offline PDF ${MARKER}`), PDF_TYPE],
    ["offline.docx", docx(`Offline Word ${MARKER}`), DOCX_TYPE],
  ];
  for (const [name, bytes, type] of files) {
    const document = await importDocument(alice, project, name, bytes, type);
    const extracted = await http("/functions/v1/extract-text", {
      token: alice.access,
      json: { file_path: document.path, project_id: project, document_id: document.id },
    });
    assertEquals(extracted.status, 200, `${name}: ${extracted.text}`);
    const [row] = (await http(`/rest/v1/imported_documents?id=eq.${document.id}&select=extracted_text`, { token: alice.access })).json();
    assertStringIncludes(row?.extracted_text ?? "", MARKER, `${name}: the text did not come out`);
  }
});

live("local-only: nothing that holds or reads the writing reaches the internet; the relay reaches Ollama (T60)", async () => {
  const computer = await computerAddress();
  const reached: string[] = [];
  for (const name of SERVICES) {
    const results = await probe({ container: (await service(name)).id }, [{ name: "internet", host: "1.1.1.1", port: 443 }]);
    if (results.internet === "reached") reached.push(name);
  }
  assertEquals(reached, []);

  const functions = await probe({ container: (await service("functions")).id }, [
    { name: "the relay", host: "ollama.internal", port: 11434 },
    { name: "Ollama, directly", host: computer, port: 11434 },
  ]);
  assertEquals(functions["the relay"], "reached");
  assertNotEquals(functions["Ollama, directly"], "reached", "the functions reach this computer without the relay");

  const relay = await probe({ container: (await service("relay")).id }, [{ name: "Ollama", host: computer, port: 11434 }]);
  assertEquals(relay.Ollama, "reached");
});

live("local-only: off gives the functions their way out back and takes the relay away", async () => {
  const off = await sylou("local-only", "off");
  assertEquals(off.code, 0, hide(off.out + off.err));
  await waitForFunctions();
  assertEquals((await containers()).filter((container) => container.service === "relay"), [], "the relay is still there");
  assertEquals(Object.keys((await service("functions")).networks).sort(), [install.backend, install.egress].sort());
  const results = await probe({ container: (await service("functions")).id }, [{ name: "internet", host: "1.1.1.1", port: 443 }]);
  assertEquals(results.internet, "reached", "the functions did not get their way out back");
  const config = await http("/functions/v1/config", { token: alice.access });
  assertEquals(config.json().local_only, undefined);
  assertEquals(config.json().web_search_enabled, true);
});

live("logs: still no secret, key or writing in any log, after all of that (T19)", async () => {
  await assertNothingInLogs();
});
