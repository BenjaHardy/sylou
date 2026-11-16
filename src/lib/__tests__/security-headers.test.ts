// The browser security headers live in three host files: vercel.json
// (Vercel), public/_headers (Cloudflare Pages, Netlify) and, for a Sylou
// Local install, sylou-local/web/headers.conf with its nginx.conf. Nothing in
// the build reads them, so only this test notices when they drift apart or
// when the Content-Security-Policy loses one of its strict parts.
//
// What this test cannot see is a header a running nginx drops again: the
// package tests check /report/x on a real request, because an internal
// redirect there once replaced two headers with another block's.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSP_HEADER = "Content-Security-Policy";

type HeaderRules = Record<string, Record<string, string>>;

// vitest runs from the repository root (see migrations-privileges.test.ts).
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

// Vercel's "/report/(.*)" is "/report/*" in _headers.
function vercelRules(): HeaderRules {
  const config = JSON.parse(read("vercel.json")) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  return Object.fromEntries(
    config.headers.map((rule) => [
      rule.source.replace(/\(\.\*\)$/, "*"),
      Object.fromEntries(rule.headers.map((h) => [h.key, h.value])),
    ]),
  );
}

function headersFileRules(): HeaderRules {
  const rules: HeaderRules = {};
  let path = "";
  for (const line of read("public", "_headers").split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      path = line.trim();
      rules[path] = {};
    } else {
      const colon = line.indexOf(":");
      rules[path][line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
    }
  }
  return rules;
}

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d): [string, string[]] => {
        const [name, ...sources] = d.split(/\s+/);
        return [name, sources];
      }),
  );
}

// Every `add_header name "value" always;` of an nginx config file, by name.
function nginxHeaders(...parts: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const match of read(...parts).matchAll(/^\s*add_header\s+(\S+)\s+"([^"]*)"\s+always;/gm)) {
    headers[match[1]] = match[2];
  }
  return headers;
}

/** The `location` blocks of the package's door, each with its own body. */
function doorBlocks(): { path: string; body: string }[] {
  const config = read("sylou-local", "web", "nginx.conf");
  const blocks: { path: string; body: string }[] = [];
  const opening = /^\s*location\s+(.+?)\s*\{$/gm;
  for (const match of config.matchAll(opening)) {
    const from = match.index! + match[0].length;
    let depth = 1;
    let i = from;
    while (i < config.length && depth > 0) {
      if (config[i] === "{") depth++;
      if (config[i] === "}") depth--;
      i++;
    }
    blocks.push({ path: match[1], body: config.slice(from, i - 1) });
  }
  return blocks;
}

describe("security headers", () => {
  const vercel = vercelRules();

  it("vercel.json and public/_headers send the same headers on the same paths", () => {
    expect(headersFileRules()).toEqual(vercel);
  });

  it("every path gets the policy, nosniff and a refusal to be framed", () => {
    expect(vercel["/*"]?.[CSP_HEADER]).toBeTruthy();
    expect(vercel["/*"]["X-Content-Type-Options"]).toBe("nosniff");
    expect(vercel["/*"]["X-Frame-Options"]).toBe("DENY");
  });

  describe("the Content-Security-Policy", () => {
    const policy = directives(vercel["/*"]?.[CSP_HEADER] ?? "");

    it("runs scripts from the app's own files only: nothing inline, no eval, no other host", () => {
      expect(policy.get("default-src")).toEqual(["'self'"]);
      expect(policy.get("script-src")).toEqual(["'self'"]);
    });

    it("refuses plugins, a rewritten base URL, outside form targets and every framing page", () => {
      expect(policy.get("object-src")).toEqual(["'none'"]);
      expect(policy.get("base-uri")).toEqual(["'none'"]);
      expect(policy.get("form-action")).toEqual(["'self'"]);
      expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    });

    it("allows inline code for styles only, eval nowhere, and Supabase for connections only", () => {
      for (const [name, sources] of policy) {
        if (name !== "style-src") expect(sources, name).not.toContain("'unsafe-inline'");
        if (name !== "connect-src") expect(sources, name).not.toContain("https://*.supabase.co");
        expect(sources, name).not.toContain("'unsafe-eval'");
      }
      expect(policy.get("connect-src")).toContain("https://*.supabase.co");
    });

    it("never allows every host of a scheme", () => {
      for (const [name, sources] of policy) {
        expect(sources.filter((s) => /^(\*|https?:|wss?:)$/.test(s)), name).toEqual([]);
      }
    });
  });

  // A Sylou Local install serves its own pages, so its headers come from
  // nginx rather than from a host's configuration file.
  describe("the Sylou Local door (sylou-local/web)", () => {
    const shared = nginxHeaders("sylou-local", "web", "headers.conf");

    it("sends the hosted headers, with Supabase dropped from connect-src: everything is its own address", () => {
      const hosted = directives(vercel["/*"][CSP_HEADER]);
      const local = directives(shared[CSP_HEADER]);
      expect([...local.keys()]).toEqual([...hosted.keys()]);
      for (const [name, sources] of hosted) {
        const expected = name === "connect-src" ? sources.filter((s) => s === "'self'") : sources;
        expect(local.get(name), name).toEqual(expected);
      }
      expect(local.get("connect-src")).toEqual(["'self'"]);
      expect(shared["X-Content-Type-Options"]).toBe(vercel["/*"]["X-Content-Type-Options"]);
      expect(shared["X-Frame-Options"]).toBe(vercel["/*"]["X-Frame-Options"]);
    });

    it("keeps a shared report out of search engines and sends no referrer, as hosted does", () => {
      const report = doorBlocks().find((block) => block.path === "/report/");
      expect(report).toBeDefined();
      const headers = Object.fromEntries(
        [...report!.body.matchAll(/add_header\s+(\S+)\s+"([^"]*)"\s+always;/g)].map((m) => [m[1], m[2]]),
      );
      expect(headers["X-Robots-Tag"]).toBe(vercel["/report/*"]["X-Robots-Tag"]);
      expect(headers["Referrer-Policy"]).toBe(vercel["/report/*"]["Referrer-Policy"]);
    });

    it("serves the report page inside its own block: try_files would drop the two headers above", () => {
      const report = doorBlocks().find((block) => block.path === "/report/")!;
      expect(report.body).toContain("rewrite ^ /index.html break;");
      expect(report.body).not.toContain("try_files");
    });

    it("every block that adds a header of its own includes the shared set, which nginx would otherwise drop", () => {
      for (const block of doorBlocks()) {
        if (!block.body.includes("add_header")) continue;
        expect(block.body, block.path).toContain("include /etc/nginx/sylou/headers.conf;");
      }
    });
  });
});
