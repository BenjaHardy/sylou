// The functions' libraries as a CycloneDX SBOM, so a scanner can check them.
//
// The functions image is built from sylou-local/functions/deno.lock, which
// names every package the eight functions load, each with its hash (D12).
// OSV-Scanner cannot read Deno's lockfile, so this writes the same list in
// the format the scanner that checks our images reads: one component per npm
// package, named by its purl (D27).
//
//   deno task sbom:functions > functions.cdx.json      (from sylou-local/)
import { createHash } from "node:crypto";

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
  /** `urn:uuid:…`: a signed SBOM needs one (actions/attest refuses it without). */
  serialNumber: string;
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

/** The URL namespace of RFC 9562, for `nameUuid`. */
export const URL_NAMESPACE = "6ba7b811-9dad-11d1-80b4-00c04fd430c8";

/**
 * A UUID made from a name (version 5, SHA-1, RFC 9562): the same name always
 * gives the same UUID, so a serial number made this way keeps "the same
 * lockfile gives the same bytes". CycloneDX 1.5 accepts versions 1 to 5 only.
 */
export function nameUuid(name: string, namespace = URL_NAMESPACE): string {
  const space = new Uint8Array(16);
  const digits = namespace.replaceAll("-", "");
  for (let i = 0; i < 16; i++) space[i] = parseInt(digits.slice(2 * i, 2 * i + 2), 16);
  const bytes = createHash("sha1").update(space).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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
  // The same lockfile gives the same bytes: sorted, no date, and a serial
  // number made from what the SBOM lists.
  components.sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${nameUuid(JSON.stringify({ subject, components }))}`,
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
