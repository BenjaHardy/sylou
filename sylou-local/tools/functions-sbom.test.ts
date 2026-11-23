// The functions' SBOM: every package the functions image is built with must
// be in it, named so a scanner can look it up - a package missing here is a
// package no scan ever checks.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl } from "https://deno.land/std@0.224.0/path/mod.ts";
import { type DenoLock, nameUuid, purlOf, sbomFromLock, splitKey } from "./functions-sbom.ts";

const LOCK = fromFileUrl(new URL("../functions/deno.lock", import.meta.url));
const lock = JSON.parse(Deno.readTextFileSync(LOCK)) as DenoLock;

Deno.test("every npm package of the functions' lockfile is in the SBOM, by its purl", () => {
  const sbom = sbomFromLock(lock);
  const purls = new Set(sbom.components.map((component) => component.purl));
  const keys = Object.keys(lock.npm ?? {});
  assert(keys.length > 0, "the lockfile names no package");
  for (const key of keys) {
    const { name, version } = splitKey(key);
    assert(purls.has(purlOf(name, version)), `${key} is not in the SBOM`);
  }
  assertEquals(sbom.components.length, keys.length);
});

Deno.test("a scoped package is named as the purl spec and CycloneDX name it", () => {
  const sbom = sbomFromLock(lock);
  const supabase = sbom.components.find((component) => component.purl.includes("supabase-js"));
  assertEquals(supabase?.purl, "pkg:npm/%40supabase/supabase-js@2.110.5");
  assertEquals(supabase?.group, "@supabase");
  assertEquals(supabase?.name, "supabase-js");
  // And a plain one has no group at all.
  const mammoth = sbom.components.find((component) => component.name === "mammoth");
  assertEquals(mammoth?.purl, "pkg:npm/mammoth@1.12.3");
  assertEquals(mammoth?.group, undefined);
});

Deno.test("an underscore in a name stays, and a peer suffix after a version goes", () => {
  assertEquals(splitKey("string_decoder@1.1.1"), { name: "string_decoder", version: "1.1.1" });
  assertEquals(splitKey("@scope/plugin@2.0.0_react@19.1.0"), { name: "@scope/plugin", version: "2.0.0" });
});

Deno.test("the lockfile's hashes come along, as hexadecimal SHA-512", () => {
  for (const component of sbomFromLock(lock).components) {
    const hash = component.hashes?.[0];
    assertEquals(hash?.alg, "SHA-512", component.purl);
    assert(/^[0-9a-f]{128}$/.test(hash?.content ?? ""), `${component.purl}: ${hash?.content}`);
  }
});

Deno.test("the same lockfile gives the same SBOM, a CycloneDX document a scanner reads", () => {
  const first = JSON.stringify(sbomFromLock(lock));
  assertEquals(JSON.stringify(sbomFromLock(structuredClone(lock))), first);
  const sbom = JSON.parse(first);
  assertEquals(sbom.bomFormat, "CycloneDX");
  assertEquals(sbom.specVersion, "1.5");
  assertEquals(sbom.metadata.component.name, "sylou-functions");
});

// The release signs this SBOM, and actions/attest takes a CycloneDX document
// only with bomFormat, specVersion and serialNumber all there.
Deno.test("the SBOM carries a serial number: the same for the same lockfile, another for another", () => {
  const sbom = sbomFromLock(lock);
  // CycloneDX 1.5's own pattern for it, and a version 5 (name-based) UUID.
  const uuid = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert(uuid.test(sbom.serialNumber), sbom.serialNumber);
  assertEquals(sbomFromLock(structuredClone(lock)).serialNumber, sbom.serialNumber);

  const { ["mammoth@1.12.3"]: _gone, ...fewer } = lock.npm ?? {};
  assert(sbomFromLock({ ...lock, npm: fewer }).serialNumber !== sbom.serialNumber, "a different list kept the number");
  assert(sbomFromLock(lock, "another").serialNumber !== sbom.serialNumber, "another subject kept the number");
});

Deno.test("a name-based UUID is the one RFC 9562 gives for that name", () => {
  // Python's uuid.uuid5(uuid.NAMESPACE_DNS, "www.example.com").
  assertEquals(nameUuid("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
});
