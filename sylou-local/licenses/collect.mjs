// The licence files of the third-party packages an image is built from,
// gathered into one folder for the image's /licenses.
//
// Each package's own files are copied as the registry served them, so the
// integrity the lockfile records for the package covers them too. A package
// that ships no licence file is represented by its README, where such
// packages keep their notice, and the index names the licence its
// package.json declares.
//
//   node collect.mjs npm <package-lock.json> <folder holding node_modules> <out>
//   deno run --allow-read --allow-write collect.mjs deno <deno.lock> <npm cache> <out>
//
// It runs under Node in the web image's build and under Deno in the
// functions image's, so it uses only node: modules both provide.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LICENCE_FILE = /^(licen[cs]e|copying|notice|copyright)([.\-_].*)?$/i;
const README_FILE = /^readme([.\-_].*)?$/i;

const INDEX_HEADER = [
  "Third-party packages in this image, each with the licence its package.json",
  "declares and the files of its own that carry it, copied into the folder of",
  "the same name. Written at build time from the lockfile the image was built",
  "with.",
  "",
  "",
].join("\n");

/**
 * The packages a package-lock.json installs for the app itself: everything
 * but what only its tooling needs, each with the folder npm puts it in.
 * The same reading as scripts/generate-third-party-licenses.mjs, whose list
 * of runtime packages these texts go with.
 */
export function npmPackages(lock, root) {
  const found = new Map();
  for (const [path, info] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith("node_modules/") || info.dev === true || info.link === true) continue;
    const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    const key = `${name}@${info.version}`;
    if (found.has(key)) continue;
    // npm leaves out an optional package built for another system.
    const optional = info.optional === true || info.devOptional === true;
    found.set(key, { name, version: info.version, dir: join(root, path), optional });
  }
  return [...found.values()];
}

/** The npm packages a deno.lock names, each in Deno's npm cache. */
export function denoPackages(lock, cache) {
  return Object.keys(lock.npm ?? {}).map((key) => {
    // "@scope/name@1.2.3" and "name@1.2.3", with Deno's "_peer@x" suffix for
    // a package resolved against particular peers.
    const at = key.indexOf("@", key.startsWith("@") ? 1 : 0);
    const name = key.slice(0, at);
    const version = key.slice(at + 1).split("_")[0];
    return { name, version, dir: join(cache, name, version), optional: false };
  });
}

/** The licence a package.json declares, in any of the forms npm has used. */
export function declaredLicence(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === "string" && license.trim() !== "") return license.trim();
  if (license && typeof license.type === "string") return license.type;
  if (Array.isArray(licenses) && licenses.length > 0) {
    return licenses.map((entry) => (typeof entry === "string" ? entry : entry.type)).join(" OR ");
  }
  return undefined;
}

/** Copies each package's licence files under `out`, and writes the index. */
export function collect(packages, out) {
  const lines = [];
  const sorted = [...packages].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
  for (const pkg of sorted) {
    const id = `${pkg.name}@${pkg.version}`;
    if (!existsSync(join(pkg.dir, "package.json"))) {
      if (pkg.optional) continue;
      throw new Error(`${id} is not installed at ${pkg.dir}`);
    }
    const declared = declaredLicence(JSON.parse(readFileSync(join(pkg.dir, "package.json"), "utf8")));
    const own = readdirSync(pkg.dir).filter((entry) => statSync(join(pkg.dir, entry)).isFile()).sort();
    let files = own.filter((entry) => LICENCE_FILE.test(entry));
    let note = "";
    if (files.length === 0) {
      files = own.filter((entry) => README_FILE.test(entry));
      if (files.length > 0) note = " (it ships no licence file; its README carries the notice)";
    }
    if (files.length === 0 && declared === undefined) {
      throw new Error(`${id} ships no licence file and declares no licence`);
    }
    const target = join(out, id);
    mkdirSync(target, { recursive: true });
    for (const file of files) copyFileSync(join(pkg.dir, file), join(target, file));
    lines.push(`${id}  ${declared ?? "no licence declared"}  ${files.join(", ") || "no file"}${note}`);
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "index.txt"), INDEX_HEADER + lines.join("\n") + "\n");
  return lines.length;
}

function main(args) {
  const [kind, lockfile, where, out] = args;
  if (!["npm", "deno"].includes(kind) || !lockfile || !where || !out) {
    console.error("usage: collect.mjs npm|deno <lockfile> <node_modules parent | npm cache> <out>");
    return 2;
  }
  const lock = JSON.parse(readFileSync(lockfile, "utf8"));
  const packages = kind === "npm" ? npmPackages(lock, where) : denoPackages(lock, where);
  const count = collect(packages, out);
  console.log(`Licence files of ${count} packages written to ${out}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
