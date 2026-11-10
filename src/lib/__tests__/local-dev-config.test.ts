// The local developer setup (`supabase start` + `npm run dev`) runs on one
// computer. Nothing in the build reads these settings, so only this test
// notices when the dev server is opened to the network again or when a
// service Sylou does not use comes back on.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// vitest runs from the repository root (see migrations-privileges.test.ts).
const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

/** The `key = value` lines of one `[section]` of supabase/config.toml, values as written. */
function tomlSection(name: string): Record<string, string> {
  const values: Record<string, string> = {};
  let current = "";
  for (const raw of read("supabase", "config.toml").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      current = header[1];
      continue;
    }
    const eq = line.indexOf("=");
    if (current === name && eq > 0) values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

describe("local developer setup", () => {
  it("the dev server listens on this computer only", () => {
    const vite = read("vite.config.ts");
    expect(vite).toMatch(/host:\s*"localhost"/);
    expect(vite).not.toMatch(/host:\s*("::"|"0\.0\.0\.0"|true)/);
  });

  it("sign-in emails link back to the dev server, and sign-ups stay closed", () => {
    const port = read("vite.config.ts").match(/port:\s*(\d+)/)?.[1];
    const auth = tomlSection("auth");
    expect(auth.site_url).toBe(`"http://localhost:${port}"`);
    expect(auth.enable_signup).toBe("false");
  });

  it("the services Sylou does not use stay off", () => {
    for (const section of ["studio", "realtime", "analytics", "storage.s3_protocol", "storage.image_transformation"]) {
      expect(tomlSection(section).enabled, section).toBe("false");
    }
  });

  it("the local database runs the major version the database tests use", () => {
    const ciMajor = read(".github", "workflows", "ci.yml").match(/image:\s*postgres:(\d+)\./)?.[1];
    expect(ciMajor).toBeDefined();
    expect(tomlSection("db").major_version).toBe(ciMajor);
  });
});
