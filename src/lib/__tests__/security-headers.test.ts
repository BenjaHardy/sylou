// The browser security headers live in two host files: vercel.json (Vercel)
// and public/_headers (Cloudflare Pages, Netlify). Nothing in the build reads
// them, so only this test notices when the two drift apart or when the
// Content-Security-Policy loses one of its strict parts.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Report-Only while the policy is checked on staging.
const CSP_HEADER = "Content-Security-Policy-Report-Only";

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
});
