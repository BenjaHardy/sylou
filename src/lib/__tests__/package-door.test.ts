// The front door of a Sylou Local install (sylou-local/web/nginx.conf): which
// names it answers to, which paths it forwards, and what it never lets near
// the services behind it. Nothing in the build reads that file, so only this
// test notices when a rule is dropped — the headers it sets are pinned by
// security-headers.test.ts, and the package tests exercise all of it on a
// running container.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// vitest runs from the repository root (see migrations-privileges.test.ts).
const config = readFileSync(join(process.cwd(), "sylou-local", "web", "nginx.conf"), "utf8");

/** Each `location <path> { … }`, with its own body. */
function blocks(): { path: string; body: string }[] {
  const found: { path: string; body: string }[] = [];
  for (const match of config.matchAll(/location\s+([^{\n]+?)\s*\{/g)) {
    let depth = 1;
    let i = match.index! + match[0].length;
    const from = i;
    while (i < config.length && depth > 0) {
      if (config[i] === "{") depth++;
      if (config[i] === "}") depth--;
      i++;
    }
    found.push({ path: match[1], body: config.slice(from, i - 1) });
  }
  return found;
}

const block = (path: string) => blocks().find((b) => b.path === path);
const forwarding = () => blocks().filter((b) => b.body.includes("proxy_pass"));

describe("the Sylou Local door", () => {
  it("listens on one port, and publishes none: the entry container holds the port", () => {
    const listens = [...config.matchAll(/^\s*listen\s+(.+);$/gm)].map((m) => m[1]);
    expect(listens).toEqual(["8080 default_server", "8080"]);
  });

  it("answers only to this computer's own names; any other Host gets the connection closed", () => {
    const names = [...config.matchAll(/^\s*server_name\s+(.+);$/gm)].map((m) => m[1]);
    expect(names).toEqual(["_", "localhost 127.0.0.1"]);
    // The catch-all server answers nothing at all, not even a status.
    const catchAll = config.slice(config.indexOf("server_name _;"), config.indexOf("server_name localhost"));
    expect(catchAll).toContain("return 444;");
    expect(catchAll).not.toContain("proxy_pass");
    expect(catchAll).not.toContain("root");
  });

  it("forwards four paths and nothing else, each to the gateway", () => {
    expect(forwarding().map((b) => b.path)).toEqual([
      "/auth/v1/",
      "/rest/v1/",
      "^~ /storage/v1/object/",
      "~ ^/functions/v1/(?:analysis|chat|config|context-prompt|delete-account|editor-action|extract-text|share-report)(?:/|$)",
    ]);
    for (const b of forwarding()) expect(b.body, b.path).toContain("proxy_pass http://$gateway;");
  });

  it("forwards exactly the functions this repository has: a new one is unreachable until it is listed", () => {
    const listed = forwarding()
      .find((b) => b.path.includes("/functions/v1/"))!
      .path.match(/\(\?:([a-z-|]+)\)/)![1]
      .split("|");
    const functions = join(process.cwd(), "supabase", "functions");
    const onDisk = readdirSync(functions, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(functions, name, "index.ts")));
    expect([...listed].sort()).toEqual([...onDisk].sort());
  });

  it("never forwards the admin API, storage's other paths, an unknown function or a service's own pages", () => {
    const refused = [
      "^~ /auth/v1/admin",
      "^~ /storage/v1/",
      "/functions/v1/",
      "~ ^/(?:pg|studio|realtime|analytics|graphql)(?:/|$)",
    ];
    for (const path of refused) {
      const b = block(path);
      expect(b, path).toBeDefined();
      expect(b!.body.trim(), path).toBe("return 404;");
    }
    // The admin API is refused by a prefix nothing longer can re-open, and
    // storage lets only the object path through (a longer ^~ prefix).
    expect(blocks().map((b) => b.path)).not.toContain("/auth/v1/admin/");
    expect(config.indexOf("^~ /storage/v1/")).toBeLessThan(config.indexOf("^~ /storage/v1/object/"));
  });

  it("answers no cross-site request: every CORS header a service sends is dropped, and none is added", () => {
    const hidden = [...config.matchAll(/proxy_hide_header\s+(Access-Control-\S+);/g)].map((m) => m[1]);
    expect(hidden.sort()).toEqual([
      "Access-Control-Allow-Credentials",
      "Access-Control-Allow-Headers",
      "Access-Control-Allow-Methods",
      "Access-Control-Allow-Origin",
      "Access-Control-Allow-Private-Network",
      "Access-Control-Expose-Headers",
      "Access-Control-Max-Age",
    ]);
    expect(config).not.toMatch(/add_header\s+Access-Control/);
  });

  it("lets a function's answer stream, and waits longer than the worker that produces it", () => {
    const functions = forwarding().find((b) => b.path.includes("/functions/v1/"))!.body;
    expect(functions).toContain("proxy_buffering off;");
    expect(functions).toContain("proxy_request_buffering off;");
    // The worker's own wall clock is 600 s: it must be what ends a long
    // answer, never this door.
    for (const match of functions.matchAll(/proxy_(?:read|send)_timeout\s+(\d+)s;/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(620);
    }
  });

  it("writes only where the read-only filesystem allows, and runs a modest number of workers", () => {
    for (const match of config.matchAll(/^\s*\w+_temp_path\s+(\S+);$/gm)) {
      expect(match[1].startsWith("/tmp/"), match[0].trim()).toBe(true);
    }
    expect(config).toContain("pid /tmp/nginx.pid;");
    const workers = Number(config.match(/^worker_processes\s+(\d+);$/m)![1]);
    expect(workers).toBeGreaterThan(0);
    expect(workers).toBeLessThanOrEqual(4);
  });
});

// Behind the door, in the same image: the gateway that reaches the four
// Supabase services. A function has to be named in both files and in the
// image's bundle loop, or a local install cannot reach it.
describe("the gateway inside a Sylou Local install", () => {
  const gateway = readFileSync(join(process.cwd(), "sylou-local", "web", "gateway.conf"), "utf8");
  const dockerfile = readFileSync(join(process.cwd(), "sylou-local", "functions", "Dockerfile"), "utf8");

  /** The eight function folders this repository has. */
  const functionNames = (): string[] => {
    const functions = join(process.cwd(), "supabase", "functions");
    return readdirSync(functions, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(functions, name, "index.ts")))
      .sort();
  };

  it("forwards the four service paths and nothing else", () => {
    const paths = [...gateway.matchAll(/location\s+([^{\n]+?)\s*\{/g)].map((match) => match[1]);
    expect(paths).toEqual([
      "/auth/v1/",
      "/rest/v1/",
      "/storage/v1/",
      "~ ^/functions/v1/(?:analysis|chat|config|context-prompt|delete-account|editor-action|extract-text|share-report)(?:/|$)",
      "/",
    ]);
    // Everything that is not one of the four is refused here too.
    expect(gateway).toMatch(/location\s+\/\s*\{\s*return 404;\s*\}/);
    // What the comments explain does not count; only what nginx reads.
    const directives = gateway
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n")
      .toLowerCase();
    for (const absent of ["studio", "pg-meta", "graphql", "realtime", "/auth/v1/admin"]) {
      expect(directives, absent).not.toContain(absent);
    }
  });

  it("knows exactly the functions this repository has, in the config and in the image", () => {
    const listed = gateway
      .match(/\^\/functions\/v1\/\(\?:([a-z-|]+)\)/)![1]
      .split("|")
      .sort();
    expect(listed).toEqual(functionNames());

    // The image bundles the same set: one eszip per name, built at build time.
    const bundled = dockerfile.match(/for name in ([a-z0-9 -]+); do/)![1].trim().split(/\s+/).sort();
    expect(bundled).toEqual(functionNames());
  });

  it("answers no cross-site request either, and lets a function's answer stream", () => {
    const hidden = [...gateway.matchAll(/proxy_hide_header\s+(Access-Control-\S+);/g)].map((m) => m[1]);
    expect(hidden.length).toBe(7);
    expect(gateway).not.toMatch(/add_header\s+Access-Control/);

    const functionsBlock = gateway.slice(gateway.indexOf("location ~ ^/functions/v1/"));
    expect(functionsBlock).toContain("proxy_buffering off;");
    // The worker's own clock is 600 s: it must end a long answer, not this.
    for (const match of functionsBlock.matchAll(/proxy_(?:read|send)_timeout\s+(\d+)s;/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(620);
    }
  });

  it("writes only where the read-only filesystem allows", () => {
    for (const match of gateway.matchAll(/^\s*\w+_temp_path\s+(\S+);$/gm)) {
      expect(match[1].startsWith("/tmp/"), match[0].trim()).toBe(true);
    }
    expect(gateway).toContain("pid /tmp/nginx.pid;");
  });
});

// The package does not fork the app: it builds the same src/, bundles the
// same functions and applies the same migrations. What it does repeat is
// lists and numbers — which functions exist, which settings reach a worker,
// how large a file may be, how long a password must be. These are what drift
// between hosted Sylou and an install, so each one is pinned here.
describe("what a Sylou Local install repeats from hosted Sylou", () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");
  const router = read("sylou-local", "functions", "main.ts");
  const compose = read("sylou-local", "compose.yaml");
  const entrypoint = read("sylou-local", "web", "docker-entrypoint.d", "40-sylou-runtime.sh");
  const users = read("sylou-local", "tools", "users.ts");

  const functionNames = (): string[] => {
    const functions = join(process.cwd(), "supabase", "functions");
    return readdirSync(functions, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .filter((name) => existsSync(join(functions, name, "index.ts")))
      .sort();
  };

  /** The names in one of the router's own lists. */
  const listOf = (name: string): string[] => {
    const body = router.match(new RegExp(`const ${name} = (?:new Set\\()?\\[([^\\]]*)\\]`))?.[1] ?? "";
    return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
  };

  it("the router serves exactly the functions this repository has", () => {
    expect(listOf("NAMES")).toEqual(functionNames());
  });

  it("the router reads the local-only switch the way the functions do", () => {
    // One reading, so the router never hands out a cloud key the functions
    // would refuse to use, or the reverse.
    expect(router).toContain('import { localOnly } from "../../supabase/functions/_shared/_local_only.ts";');
    expect(router).not.toMatch(/env\.get\(\s*"SYLOU_LOCAL_ONLY"/);
    // And the image keeps that file where the import looks for it.
    const dockerfile = read("sylou-local", "functions", "Dockerfile");
    expect(dockerfile).toContain("COPY sylou-local/functions/main.ts /home/deno/sylou-local/functions/index.ts");
    expect(dockerfile).toContain(
      "COPY supabase/functions/_shared/_local_only.ts /home/deno/supabase/functions/_shared/_local_only.ts",
    );
    expect(dockerfile).toContain('"--main-service", "/home/deno/sylou-local/functions"');
  });

  it("every setting the functions read is one a local install passes them", () => {
    // Every string an edge function asks the environment for, including the
    // names kept in a constant (SYLOU_LOCAL_ONLY, the provider keys).
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules") continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) sources.push(readFileSync(path, "utf8"));
      }
    };
    walk(join(process.cwd(), "supabase", "functions"));

    const asked = new Set<string>();
    for (const source of sources) {
      for (const match of source.matchAll(/env\.get\(\s*"([A-Z][A-Z0-9_]+)"/g)) asked.add(match[1]);
      for (const match of source.matchAll(/=\s*"((?:SYLOU|OLLAMA|SUPABASE)_[A-Z0-9_]+|[A-Z]+_API_KEY)"/g)) asked.add(match[1]);
    }

    // What a worker is given, plus the names the platform sets for it.
    const given = new Set([...listOf("PLAIN"), ...listOf("SECRETS")]);
    const platform = new Set([
      // Supabase's own platform sets these on hosted; inside the package the
      // router passes the two keys from files, under these same names.
      "SUPABASE_URL",
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);
    const missing = [...asked].filter((name) => !given.has(name) && !platform.has(name)).sort();
    expect(
      missing,
      `read by a function but never passed to one in a Sylou Local install — add to PLAIN or SECRETS in sylou-local/functions/main.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("the largest file is the same size everywhere it is written down", () => {
    // The app refuses it, the function refuses it, storage refuses it, and
    // the two nginx layers in front allow it plus its envelope.
    const appLimit = read("src", "hooks", "useImportedDocuments.ts").match(/MAX_FILE[A-Z_]*\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/);
    expect(appLimit?.[1]).toBe("10");
    expect(read("supabase", "functions", "extract-text", "index.ts")).toContain("10 * 1024 * 1024");
    expect(compose).toContain('FILE_SIZE_LIMIT: "10485760"');
    for (const name of ["nginx.conf", "gateway.conf"]) {
      expect(read("sylou-local", "web", name), name).toContain("client_max_body_size 11m;");
    }
  });

  it("a password's minimum length is the same number in all four places", () => {
    // The sign-in service enforces it, the page asks for it, the image's
    // start-up script defaults to it, and the command says it out loud.
    expect(compose).toContain('GOTRUE_PASSWORD_MIN_LENGTH: "15"');
    expect(compose).toContain('SYLOU_MIN_PASSWORD_LENGTH: "15"');
    expect(entrypoint).toMatch(/SYLOU_MIN_PASSWORD_LENGTH:?-?15/);
    expect(users).toContain("at least 15 characters");
  });
});
