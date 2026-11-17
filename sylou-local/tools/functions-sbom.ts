// The functions' libraries as a CycloneDX SBOM, so a scanner can check them.
//
// The functions image is built from sylou-local/functions/deno.lock, which
// names every package the eight functions load, each with its hash (D12).
// OSV-Scanner cannot read Deno's lockfile, so this writes the same list in
// the format the scanner that checks our images reads: one component per npm
// package, named by its purl (D27).
//
//   deno task sbom:functions > functions.cdx.json      (from sylou-local/)

export interface DenoLock {
  version?: string;
  npm?: Record<string, { integrity?: string }>;
}

export interface Component {
  type: "library";
  "bom-ref": string;
  group?: string;
  name: string;
  version: string;
  purl: string;
  hashes?: { alg: "SHA-512"; content: string }[];
}

export interface Sbom {
  bomFormat: "CycloneDX";
  specVersion: "1.5";
  version: 1;
  metadata: { component: { type: "application"; name: string } };
  components: Component[];
}

/**
 * A lockfile key, `name@version`, split. A scoped name starts with an @ of
 * its own, and a package resolved against a peer carries `_<peer>@<version>`
 * after its version - while a name may hold an underscore itself
 * (`string_decoder`), so only what follows the version is cut.
 */
export function splitKey(key: string): { name: string; version: string } {
  const at = key.indexOf("@", 1);
  if (at < 0) throw new Error(`not a package@version key: ${key}`);
  return { name: key.slice(0, at), version: key.slice(at + 1).split("_")[0] };
}

/** The package URL: a scope is the purl's namespace, its @ written %40. */
export function purlOf(name: string, version: string): string {
  const scoped = name.startsWith("@");
  const path = scoped ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${path}@${version}`;
}

/** A lockfile's base64 integrity as CycloneDX wants a hash: hexadecimal. */
function sha512Hex(integrity: string | undefined): string | undefined {
  const match = /^sha512-(.+)$/.exec(integrity ?? "");
  if (!match) return undefined;
  return Array.from(atob(match[1]), (character) => character.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}

export function sbomFromLock(lock: DenoLock, subject = "sylou-functions"): Sbom {
  const components: Component[] = [];
  for (const [key, entry] of Object.entries(lock.npm ?? {})) {
    const { name, version } = splitKey(key);
    const purl = purlOf(name, version);
    const slash = name.indexOf("/");
    const hash = sha512Hex(entry.integrity);
    components.push({
      type: "library",
      "bom-ref": purl,
      ...(name.startsWith("@") && slash > 0
        ? { group: name.slice(0, slash), name: name.slice(slash + 1) }
        : { name }),
      version,
      purl,
      ...(hash ? { hashes: [{ alg: "SHA-512" as const, content: hash }] } : {}),
    });
  }
  // The same lockfile gives the same bytes: sorted, and no date in it.
  components.sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: { component: { type: "application", name: subject } },
    components,
  };
}

if (import.meta.main) {
  const path = Deno.args[0] ?? "functions/deno.lock";
  const lock = JSON.parse(await Deno.readTextFile(path)) as DenoLock;
  console.log(JSON.stringify(sbomFromLock(lock), null, 2));
}
