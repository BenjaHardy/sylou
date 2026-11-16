// What the functions image is built from: the repository's eight functions,
// with sylou-local/functions/deno.json and deno.lock put in place of
// supabase/functions' own (sylou-local/functions/Dockerfile).
//
// The image build itself stops on a library the lockfile does not name.
// These checks catch, earlier and with the reason, the one change that would
// make that lockfile impossible to keep: a module fetched from a URL.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parse } from "https://deno.land/std@0.224.0/jsonc/mod.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";

const PACKAGE_DIR = fromFileUrl(new URL("../", import.meta.url));
const FUNCTIONS = join(PACKAGE_DIR, "..", "supabase", "functions");
const lock = JSON.parse(Deno.readTextFileSync(join(PACKAGE_DIR, "functions", "deno.lock")));
const config = parse(Deno.readTextFileSync(join(PACKAGE_DIR, "functions", "deno.json"))) as {
  imports?: Record<string, string>;
};

/** Every file a function's bundle can hold: the build deletes the tests and their helper. */
function sources(dir: string): string[] {
  const found: string[] = [];
  for (const entry of Deno.readDirSync(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) {
      if (entry.name !== "node_modules") found.push(...sources(path));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") && entry.name !== "_test_support.ts") {
      found.push(path);
    }
  }
  return found;
}

Deno.test("the functions image pins packages only, never a module fetched from a URL", () => {
  // On 2026-11-16 esm.sh served different bytes for one "immutable" URL in
  // Amsterdam and on a GitHub runner: a hash recorded for a URL on one
  // computer can stop the build on another.
  assertEquals(Object.keys(lock.remote ?? {}), [], "a module from a URL is in functions/deno.lock");
  assertEquals(Object.keys(lock.redirects ?? {}), []);
  assert(Object.keys(lock.npm ?? {}).length > 0, "functions/deno.lock names no package at all");
});

Deno.test("every esm.sh import in the functions is the same release from npm in the image", () => {
  const imported = new Set<string>();
  for (const file of sources(FUNCTIONS)) {
    for (const match of Deno.readTextFileSync(file).matchAll(/["'](https:\/\/esm\.sh\/[^"']+)["']/g)) {
      imported.add(match[1]);
    }
  }
  for (const url of imported) {
    assertEquals(
      config.imports?.[url],
      `npm:${url.slice("https://esm.sh/".length)}`,
      `${url} needs its npm twin in sylou-local/functions/deno.json, then \`deno task lock:functions\``,
    );
  }
  // And nothing left over from an import the functions no longer have.
  for (const url of Object.keys(config.imports ?? {})) {
    assert(imported.has(url), `sylou-local/functions/deno.json maps ${url}, which no function imports any more`);
  }
});
