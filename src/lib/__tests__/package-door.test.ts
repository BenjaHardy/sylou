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
