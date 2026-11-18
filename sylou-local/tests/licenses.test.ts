// The licence duties of Sylou's three images: the collector that copies each
// third-party package's own licence files, the copies kept for the parts that
// ship none, and what each Dockerfile puts in /licenses and says about the
// image in its labels.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals, assertStringIncludes, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { collect, declaredLicence, denoPackages, npmPackages } from "../licenses/collect.mjs";

const PACKAGE_DIR = fromFileUrl(new URL("../", import.meta.url));
const REPO = join(PACKAGE_DIR, "..");
const KEPT = join(PACKAGE_DIR, "licenses");

function write(path: string, text: string) {
  Deno.mkdirSync(dirname(path), { recursive: true });
  Deno.writeTextFileSync(path, text);
}

function installed(dir: string, manifest: Record<string, unknown>, files: Record<string, string> = {}) {
  write(join(dir, "package.json"), JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) write(join(dir, name), text);
}

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

function withFolder(run: (root: string) => void) {
  const root = Deno.makeTempDirSync({ prefix: "sylou-licences-" });
  try {
    run(root);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
}

Deno.test("the app's packages bring their own licence files; the tooling's are left out", () => {
  withFolder((root) => {
    installed(join(root, "node_modules/left-pad"), { license: "MIT" }, { LICENSE: "MIT, left-pad", "README.md": "#" });
    installed(join(root, "node_modules/@scope/ui"), { license: "ISC" }, { "LICENSE.md": "ISC, ui" });
    installed(join(root, "node_modules/outer"), { license: "MIT" }, { COPYING: "MIT, outer" });
    installed(join(root, "node_modules/outer/node_modules/inner"), { licenses: [{ type: "BSD-2-Clause" }] }, {
      license: "BSD, inner",
    });
    installed(join(root, "node_modules/quiet"), { license: "MIT" }, { "README.md": "## License\nMIT, quiet" });
    installed(join(root, "node_modules/bare"), { license: "MIT" });
    installed(join(root, "node_modules/vitest"), { license: "MIT" }, { LICENSE: "MIT, vitest" });
    const lock = {
      packages: {
        "": { name: "sylou" },
        "node_modules/left-pad": { version: "1.3.0" },
        "node_modules/@scope/ui": { version: "2.0.0" },
        "node_modules/outer": { version: "1.0.0" },
        "node_modules/outer/node_modules/inner": { version: "0.1.0" },
        "node_modules/quiet": { version: "1.0.0" },
        "node_modules/bare": { version: "3.0.0" },
        "node_modules/vitest": { version: "4.0.0", dev: true },
        // Built for another system, so npm did not install it here.
        "node_modules/@esbuild/darwin-arm64": { version: "0.25.0", optional: true },
      },
    };
    const out = join(root, "out");
    assertEquals(collect(npmPackages(lock, root), out), 6);

    assertEquals(Deno.readTextFileSync(join(out, "left-pad@1.3.0", "LICENSE")), "MIT, left-pad");
    assert(!exists(join(out, "left-pad@1.3.0", "README.md")), "a README is copied only in place of a licence file");
    assertEquals(Deno.readTextFileSync(join(out, "@scope/ui@2.0.0", "LICENSE.md")), "ISC, ui");
    assertEquals(Deno.readTextFileSync(join(out, "outer@1.0.0", "COPYING")), "MIT, outer");
    assertEquals(Deno.readTextFileSync(join(out, "inner@0.1.0", "license")), "BSD, inner");
    assertEquals(Deno.readTextFileSync(join(out, "quiet@1.0.0", "README.md")), "## License\nMIT, quiet");
    assert(!exists(join(out, "vitest@4.0.0")), "a package only the tooling uses was collected");

    const index = Deno.readTextFileSync(join(out, "index.txt"));
    assertStringIncludes(index, "inner@0.1.0  BSD-2-Clause  license\n");
    assertStringIncludes(index, "quiet@1.0.0  MIT  README.md (it ships no licence file; its README carries the notice)\n");
    assertStringIncludes(index, "bare@3.0.0  MIT  no file\n");
    assert(!index.includes("vitest") && !index.includes("darwin-arm64"));
  });
});

Deno.test("a package that is not there, or says nothing of its licence, stops the build", () => {
  withFolder((root) => {
    const gone = { packages: { "node_modules/gone": { version: "1.0.0" } } };
    assertThrows(() => collect(npmPackages(gone, root), join(root, "out")), Error, "gone@1.0.0 is not installed");

    installed(join(root, "node_modules/silent"), { name: "silent" }, { "index.js": "" });
    const silent = { packages: { "node_modules/silent": { version: "1.0.0" } } };
    assertThrows(
      () => collect(npmPackages(silent, root), join(root, "out")),
      Error,
      "silent@1.0.0 ships no licence file and declares no licence",
    );
  });
});

Deno.test("the functions' packages are found where Deno's npm cache keeps them", () => {
  const lock = { npm: { "@supabase/supabase-js@2.110.5": {}, "mammoth@1.12.3": {}, "react-dom@18.3.1_react@18.3.1": {} } };
  assertEquals(denoPackages(lock, "cache").map((found) => [found.name, found.version, found.dir]), [
    ["@supabase/supabase-js", "2.110.5", join("cache", "@supabase", "supabase-js", "2.110.5")],
    ["mammoth", "1.12.3", join("cache", "mammoth", "1.12.3")],
    ["react-dom", "18.3.1", join("cache", "react-dom", "18.3.1")],
  ]);
});

Deno.test("a licence is read in each of the forms package.json has used", () => {
  assertEquals(declaredLicence({ license: "MIT" }), "MIT");
  assertEquals(declaredLicence({ license: { type: "BSD-3-Clause" } }), "BSD-3-Clause");
  assertEquals(declaredLicence({ licenses: [{ type: "MIT" }, { type: "Apache-2.0" }] }), "MIT OR Apache-2.0");
  assertEquals(declaredLicence({ license: " " }), undefined);
  assertEquals(declaredLicence({}), undefined);
});

// ---------------------------------------------------------------------------
// The parts an image carries that bring no licence file of their own
// ---------------------------------------------------------------------------

function dockerfile(image: string): string {
  return Deno.readTextFileSync(join(PACKAGE_DIR, image, "Dockerfile"));
}

/** The stage an image is made of: everything after its last FROM. */
function finalStage(text: string): string {
  return text.slice(text.lastIndexOf("\nFROM "));
}

/** Each kept copy in sylou-local/licenses/, and which image needs it. */
function keptCopiesNeeded(): Map<string, string> {
  const needed = new Map<string, string>();
  // The tools load these from deno.land, where a module comes without the
  // licence of the package it belongs to.
  const toolsLock = JSON.parse(Deno.readTextFileSync(join(PACKAGE_DIR, "deno.lock")));
  const fromDenoLand: [string, string][] = [
    ["https://deno.land/std@", "deno-std"],
    ["https://deno.land/x/postgres@", "deno-postgres"],
  ];
  for (const url of Object.keys(toolsLock.remote ?? {})) {
    const kept = fromDenoLand.find(([prefix]) => url.startsWith(prefix));
    assert(kept, `${url}: the tools load a package with no licence kept for it in sylou-local/licenses/`);
    needed.set(kept[1], "tools");
  }
  // The runtimes the images are built on, which ship their binary alone.
  if (/^FROM denoland\/deno[:@]/m.test(finalStage(dockerfile("tools")))) needed.set("deno", "tools");
  if (/^FROM supabase\/edge-runtime[:@]/m.test(finalStage(dockerfile("functions")))) {
    needed.set("edge-runtime", "functions");
  }
  // PDF.js, bundled inside unpdf without its own licence.
  const functionsLock = JSON.parse(Deno.readTextFileSync(join(PACKAGE_DIR, "functions", "deno.lock")));
  if (Object.keys(functionsLock.npm ?? {}).some((key) => key.startsWith("unpdf@"))) needed.set("pdf.js", "functions");
  return needed;
}

Deno.test("every part an image carries without its licence has a copy kept, copied into that image", () => {
  const needed = keptCopiesNeeded();
  assertEquals([...needed.keys()].sort(), ["deno", "deno-postgres", "deno-std", "edge-runtime", "pdf.js"]);
  for (const [kept, image] of needed) {
    const files = [...Deno.readDirSync(join(KEPT, kept))].filter((entry) => entry.isFile);
    assert(files.length > 0, `sylou-local/licenses/${kept} holds no licence`);
    assertStringIncludes(
      finalStage(dockerfile(image)),
      `\nCOPY sylou-local/licenses/${kept} /licenses/third-party/${kept}\n`,
      `the ${image} image does not carry sylou-local/licenses/${kept}`,
    );
  }
});

Deno.test("no licence copy is kept for a part no image carries any more", () => {
  const needed = keptCopiesNeeded();
  for (const entry of Deno.readDirSync(KEPT)) {
    if (entry.isDirectory) assert(needed.has(entry.name), `sylou-local/licenses/${entry.name} is no longer needed`);
  }
});

// ---------------------------------------------------------------------------
// What each image says about itself, and the licences it carries for Sylou
// ---------------------------------------------------------------------------

/** The folders an image is built from, in the repository. */
const SOURCES: Record<string, string[]> = {
  web: ["src/"],
  functions: ["supabase/functions/"],
  tools: ["supabase/migrations/", "sylou-local/tools/"],
};

/** Whether an image carries the FLOW methodology text LICENSING.md lists. */
function carriesMethodology(image: string): boolean {
  const licensing = Deno.readTextFileSync(join(REPO, "LICENSING.md"));
  const section = licensing.slice(licensing.indexOf("## Where the methodology lives"));
  const files = [...section.slice(0, section.indexOf("\n## ", 1)).matchAll(/^\| `([^`]+)`/gm)].map((m) => m[1]);
  assert(files.length > 0, "LICENSING.md lists no file holding the methodology");
  return files.some((file) => SOURCES[image].some((folder) => file.startsWith(folder)));
}

/** The labels a Dockerfile's last LABEL sets, continuation lines joined. */
function labels(stage: string): Record<string, string> {
  const joined = stage.replaceAll("\\\n", " ");
  const label = [...joined.matchAll(/^LABEL (.+)$/gm)].at(-1);
  assert(label, "no LABEL in the image's stage");
  return Object.fromEntries([...label[1].matchAll(/([\w.-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}

for (const image of ["web", "functions", "tools"]) {
  Deno.test(`the ${image} image carries Sylou's licences and says what it is`, () => {
    const stage = finalStage(dockerfile(image));
    const methodology = carriesMethodology(image);
    const own = ["LICENSE", ...(methodology ? ["LICENSE-METHODOLOGY", "LICENSING.md"] : [])];
    if (image === "web") own.push("THIRD_PARTY_LICENSES.md");
    own.push("sylou-local/NOTICE");
    assertStringIncludes(stage, `\nCOPY ${own.join(" ")} /licenses/\n`);
    if (image !== "tools") {
      const from = image === "web" ? "build" : "locked";
      assertStringIncludes(stage, `\nCOPY --from=${from} /licenses/third-party /licenses/third-party\n`);
    }

    const set = labels(stage);
    // The base image's own labels would describe nginx or Deno otherwise.
    assertEquals(set["maintainer"], "");
    assertEquals(set["org.opencontainers.image.title"], `Sylou Local ${image}`);
    assert(set["org.opencontainers.image.description"]?.length > 0);
    assertEquals(set["org.opencontainers.image.source"], "https://github.com/BenjaHardy/sylou");
    assertEquals(set["org.opencontainers.image.url"], "https://github.com/BenjaHardy/sylou");
    assertEquals(
      set["org.opencontainers.image.licenses"],
      methodology ? "AGPL-3.0-only AND CC-BY-SA-4.0" : "AGPL-3.0-only",
    );
    // A release fills these in; an image built from a clone says so.
    assertEquals(set["org.opencontainers.image.version"], "dev");
    assertEquals(set["org.opencontainers.image.revision"], "");
    assertEquals(set["org.opencontainers.image.created"], "");
  });
}

Deno.test("the licence the images name is the one the repository is under", () => {
  const licensing = Deno.readTextFileSync(join(REPO, "LICENSING.md"));
  assertStringIncludes(licensing, "| AGPL-3.0-only |");
  assertEquals(JSON.parse(Deno.readTextFileSync(join(REPO, "package.json"))).license, "AGPL-3.0-only");
  const notice = Deno.readTextFileSync(join(PACKAGE_DIR, "NOTICE"));
  assertStringIncludes(notice, "(AGPL-3.0-only;");
  assert(!notice.includes("or-later"), "NOTICE names a licence the repository is not under");
});
