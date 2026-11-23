// The Sylou Local package a release attaches: the recipe, naming Sylou's
// published images by digest and with no build entries, and beside it the
// files a person needs to run, back up and update an install.
//
//   deno run --allow-read --allow-write release/package.ts --tag v0.8.0 \
//     --date 2026-11-18 --web sha256:… --functions sha256:… --tools sha256:… --out <folder>
//
// release.yml runs it once the images are published and signed, and checks
// the folder with tests/recipe.test.ts (SYLOU_RECIPE_DIR) before zipping it.
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";

const REPO = fromFileUrl(new URL("../../", import.meta.url));

export const IMAGES = ["web", "functions", "tools"] as const;
export type Image = typeof IMAGES[number];

export interface Release {
  tag: string;
  /** The release day, UTC: `sylou doctor` says how old an install is from it. */
  date: string;
  /** Each image's multi-platform digest. */
  digests: Record<Image, string>;
}

/** Copied as they are, from the repository into the package. */
export const COPIED: [from: string, to: string][] = [
  ["sylou-local/compose.local-only.yaml", "compose.local-only.yaml"],
  ["sylou-local/entry.conf", "entry.conf"],
  ["sylou-local/relay.conf", "relay.conf"],
  ["sylou-local/db/roles.sql", "db/roles.sql"],
  ["sylou-local/db/jwt.sql", "db/jwt.sql"],
  ["sylou-local/db/backup.sh", "db/backup.sh"],
  ["sylou-local/db/restore.sh", "db/restore.sh"],
  ["sylou-local/db/rotate.sh", "db/rotate.sh"],
  ["sylou-local/sylou", "sylou"],
  ["sylou-local/sylou.cmd", "sylou.cmd"],
  ["sylou-local/sylou.ps1", "sylou.ps1"],
  ["sylou-local/NOTICE", "NOTICE"],
  ["sylou-local/README.txt", "README.txt"],
  ["LICENSE", "LICENSE"],
];

/** Written from the repository's copy, with the release's values in. */
export const WRITTEN = ["compose.yaml", "settings.example.env", "VERSION"];

/** Replaces every match, and stops unless there were exactly `count`. */
function replaceExactly(
  text: string,
  pattern: RegExp,
  count: number,
  what: string,
  by: (match: string, ...groups: string[]) => string,
): string {
  let found = 0;
  const out = text.replace(pattern, (match: string, ...groups: string[]) => {
    found++;
    return by(match, ...groups);
  });
  if (found !== count) throw new Error(`${what}: ${count} expected in the recipe, ${found} found`);
  return out;
}

/** The recipe as a release ships it. */
export function releaseCompose(text: string, release: Release): string {
  // Sylou's six services on its three images, each by digest. The tag stays
  // for the person reading the file; Docker pulls the digest.
  let out = replaceExactly(
    text,
    /^([ \t]+)image: ghcr\.io\/benjahardy\/sylou-(web|functions|tools):\$\{SYLOU_IMAGE_TAG:-dev\}$/gm,
    6,
    "Sylou's own images",
    (_match, indent, image) => `${indent}image: ghcr.io/benjahardy/sylou-${image}:${release.tag}@${release.digests[image as Image]}`,
  );
  // A release runs the published images only, so no build entries, nor the
  // comment above one that offers building from a clone.
  out = replaceExactly(out, /^(?:[ \t]*#[^\n]*\n)*([ \t]+)build:\n(?:\1[ \t]+[^\n]*\n)+/gm, 6, "build entries", () => "");
  // A backup records the release that made it, whatever the settings say.
  out = replaceExactly(
    out,
    /^([ \t]+)SYLOU_VERSION: \$\{SYLOU_IMAGE_TAG:-dev\}$/gm,
    1,
    "the backup's release",
    (_match, indent) => `${indent}SYLOU_VERSION: ${release.tag}`,
  );
  if (out.includes("SYLOU_IMAGE_TAG")) throw new Error("the release's recipe still reads SYLOU_IMAGE_TAG");
  return out;
}

/** The example settings: the commands download this release's images. */
export function releaseSettings(text: string, release: Release): string {
  return replaceExactly(text, /^SYLOU_IMAGE_TAG=dev$/gm, 1, "SYLOU_IMAGE_TAG", () => `SYLOU_IMAGE_TAG=${release.tag}`);
}

/** Which release this is, and its day. */
export function releaseVersion(text: string, release: Release): string {
  const out = replaceExactly(text, /^version=dev$/gm, 1, "version", () => `version=${release.tag}`);
  return replaceExactly(out, /^date=$/gm, 1, "date", () => `date=${release.date}`);
}

export function checkRelease(release: Release): void {
  if (!/^v\d+\.\d+\.\d+(-rc\.\d+)?$/.test(release.tag)) throw new Error(`not a release tag: ${release.tag}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date) || Number.isNaN(Date.parse(release.date))) {
    throw new Error(`not a date: ${release.date}`);
  }
  for (const image of IMAGES) {
    if (!/^sha256:[0-9a-f]{64}$/.test(release.digests[image] ?? "")) {
      throw new Error(`not a digest for ${image}: ${release.digests[image]}`);
    }
  }
}

/** Writes the package into `out`, which must not exist yet; the folders above it may not either. */
export async function writePackage(release: Release, out: string, repo = REPO): Promise<void> {
  checkRelease(release);
  await Deno.mkdir(dirname(out), { recursive: true });
  await Deno.mkdir(out);
  const read = (path: string) => Deno.readTextFile(join(repo, "sylou-local", path));
  await Deno.writeTextFile(join(out, "compose.yaml"), releaseCompose(await read("compose.yaml"), release));
  await Deno.writeTextFile(join(out, "settings.example.env"), releaseSettings(await read("settings.example.env"), release));
  await Deno.writeTextFile(join(out, "VERSION"), releaseVersion(await read("VERSION"), release));
  for (const [from, to] of COPIED) {
    await Deno.mkdir(dirname(join(out, to)), { recursive: true });
    // Copied with its mode: the commands and the database scripts run as they are.
    await Deno.copyFile(join(repo, from), join(out, to));
  }
}

if (import.meta.main) {
  const options: Record<string, string> = {};
  for (let i = 0; i < Deno.args.length; i += 2) {
    const [name, value] = [Deno.args[i], Deno.args[i + 1]];
    if (!name?.startsWith("--") || value === undefined) {
      console.error("usage: package.ts --tag <v…> --date <YYYY-MM-DD> --web <digest> --functions <digest> --tools <digest> --out <folder>");
      Deno.exit(2);
    }
    options[name.slice(2)] = value;
  }
  const release: Release = {
    tag: options.tag,
    date: options.date,
    digests: { web: options.web, functions: options.functions, tools: options.tools },
  };
  await writePackage(release, options.out);
  console.log(`Sylou Local ${release.tag} written to ${options.out}`);
}
