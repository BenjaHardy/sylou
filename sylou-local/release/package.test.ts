// The package a release attaches (release/package.ts), written from the real
// recipe with made-up digests. release.yml also runs tests/recipe.test.ts on
// the folder it writes, so every rule of the recipe holds for it too.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals, assertMatch, assertStringIncludes, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";
import {
  checkRelease,
  COPIED,
  IMAGES,
  type Release,
  releaseCompose,
  releaseSettings,
  releaseVersion,
  WRITTEN,
  writePackage,
} from "./package.ts";

const PACKAGE_DIR = fromFileUrl(new URL("../", import.meta.url));
const read = (path: string) => Deno.readTextFileSync(join(PACKAGE_DIR, path));

const RELEASE: Release = {
  tag: "v0.8.0-rc.1",
  date: "2026-11-18",
  digests: { web: `sha256:${"a".repeat(64)}`, functions: `sha256:${"b".repeat(64)}`, tools: `sha256:${"c".repeat(64)}` },
};

Deno.test("the release's recipe names Sylou's images by digest and builds nothing", () => {
  const recipe = read("compose.yaml");
  const released = releaseCompose(recipe, RELEASE);

  const ours = released.split("\n").filter((line) => line.includes("ghcr.io/benjahardy/"));
  assertEquals(ours.length, 6);
  for (const line of ours) {
    const image = line.match(/sylou-(web|functions|tools):/)?.[1] as typeof IMAGES[number];
    assertEquals(line.trim(), `image: ghcr.io/benjahardy/sylou-${image}:v0.8.0-rc.1@${RELEASE.digests[image]}`);
  }
  assert(!/^\s+build:/m.test(released), "a build entry is left in the release's recipe");
  assert(!released.includes("docker compose build"), "the release's recipe still offers a build");
  assertStringIncludes(released, "      SYLOU_VERSION: v0.8.0-rc.1\n");
  assert(!released.includes("SYLOU_IMAGE_TAG"));

  // Nothing else moves: apart from the lines above, the release's recipe is
  // the recipe's own lines, in the same order.
  const kept = recipe.split("\n");
  let at = 0;
  for (const line of released.split("\n")) {
    if (line.includes("ghcr.io/benjahardy/") || line.includes("SYLOU_VERSION:")) continue;
    while (at < kept.length && kept[at] !== line) at++;
    assert(at < kept.length, `the release's recipe has a line the recipe does not: ${line}`);
    at++;
  }
  // Six build entries of three lines, and the two lines of comment above one.
  assertEquals(kept.length - released.split("\n").length, 6 * 3 + 2);
});

Deno.test("the release's settings download its images; its VERSION says which and when", () => {
  const settings = releaseSettings(read("settings.example.env"), RELEASE);
  assertMatch(settings, /^SYLOU_IMAGE_TAG=v0\.8\.0-rc\.1$/m);
  assertEquals(settings.replace("SYLOU_IMAGE_TAG=v0.8.0-rc.1", "SYLOU_IMAGE_TAG=dev"), read("settings.example.env"));

  const version = releaseVersion(read("VERSION"), RELEASE);
  assertMatch(version, /^version=v0\.8\.0-rc\.1$/m);
  assertMatch(version, /^date=2026-11-18$/m);
});

Deno.test("a recipe the writer no longer understands stops the release", () => {
  const recipe = read("compose.yaml");
  // One of Sylou's images renamed, or a build entry gone: the counts no
  // longer match, and nothing half-converted is written.
  assertThrows(() => releaseCompose(recipe.replace("sylou-tools:${SYLOU_IMAGE_TAG:-dev}", "sylou-tools:dev"), RELEASE));
  assertThrows(() => releaseSettings("SYLOU_PORT=8080\n", RELEASE), Error, "SYLOU_IMAGE_TAG");
  assertThrows(() => releaseVersion("version=v0.7.0\ndate=\n", RELEASE), Error, "version");
});

Deno.test("only a release tag, a day and three digests make a package", () => {
  checkRelease(RELEASE);
  checkRelease({ ...RELEASE, tag: "v1.12.3" });
  for (const tag of ["0.8.0", "v0.8", "v0.8.0-beta.1", "v0.8.0-rc.1;rm"]) {
    assertThrows(() => checkRelease({ ...RELEASE, tag }), Error, "not a release tag");
  }
  assertThrows(() => checkRelease({ ...RELEASE, date: "18/11/2026" }), Error, "not a date");
  assertThrows(() => checkRelease({ ...RELEASE, digests: { ...RELEASE.digests, web: "sha256:abc" } }), Error, "web");
});

Deno.test("the package holds every file the recipe mounts and the commands read", async () => {
  const out = join(await Deno.makeTempDir({ prefix: "sylou-release-" }), "sylou-local");
  try {
    await writePackage(RELEASE, out);
    const files: string[] = [];
    const walk = (dir: string, prefix = "") => {
      for (const entry of Deno.readDirSync(dir)) {
        if (entry.isDirectory) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else files.push(`${prefix}${entry.name}`);
      }
    };
    walk(out);
    assertEquals(files.sort(), [...WRITTEN, ...COPIED.map(([, to]) => to)].sort());

    // Every file the recipes mount, as they name it.
    const recipes = Deno.readTextFileSync(join(out, "compose.yaml")) +
      Deno.readTextFileSync(join(out, "compose.local-only.yaml"));
    const mounted = [...recipes.matchAll(/^\s*- \.\/([^:\s]+):/gm)].map((match) => match[1]);
    assert(mounted.length > 0);
    for (const path of mounted) assert(files.includes(path), `the recipe mounts ${path}, which the package lacks`);

    // Every file the two commands read from the package's folder.
    for (const [script, pattern] of [
      ["sylou", /\$PACKAGE_DIR\/([A-Za-z0-9_.-]+)/g],
      ["sylou.ps1", /Join-Path \$PackageDir "([^"]+)"/g],
    ] as const) {
      for (const match of read(script).matchAll(pattern)) {
        if (match[1] === "config") continue; // made by setup
        assert(files.includes(match[1]), `${script} reads ${match[1]}, which the package lacks`);
      }
    }

    if (Deno.build.os !== "windows") {
      for (const path of ["sylou", "db/backup.sh", "db/restore.sh", "db/rotate.sh"]) {
        assertEquals((Deno.statSync(join(out, path)).mode ?? 0) & 0o111, 0o111, `${path} is not executable`);
      }
    }
  } finally {
    await Deno.remove(join(out, ".."), { recursive: true });
  }
});
