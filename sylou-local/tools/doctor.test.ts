// What doctor makes of the facts it is given: which lines it writes, what it
// tells you to do, and - the one that matters most - that nothing secret ever
// reaches a report whose purpose is to be pasted into an issue.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type Check,
  checks,
  compareVersions,
  daysSince,
  type HostFacts,
  parseFacts,
  redact,
  render,
} from "./doctor.ts";

const NOW = Date.parse("2026-11-16T12:00:00Z");

/** A computer with nothing wrong on it. */
const HEALTHY: HostFacts = {
  platform: "windows",
  packageVersion: "0.8.0",
  packageDate: "2026-11-10",
  port: 8080,
  docker: { engine: "28.3.3", compose: "2.40.0" },
  portBinding: "Localhost only",
  listeners: [{ address: "127.0.0.1", port: 8080, process: "com.docker.backend" }],
  firewall: { inboundAllowForDocker: 0, defaultInbound: "Block" },
  bitLockerProtection: 1,
  secrets: { path: "C:\\sylou-local\\config\\secrets", ownerOnly: true, syncedTo: null },
  lastBackup: { at: "2026-11-14", path: "D:\\backups" },
};

const of = (found: Check[], id: string) => found.find((check) => check.id === id);

Deno.test("versions compare the way a person would read them", () => {
  assertEquals(compareVersions("28.3.3", "28.3.3"), 0);
  assert(compareVersions("28.4.0", "28.3.3") > 0);
  assert(compareVersions("27.9.9", "28.3.3") < 0);
  assert(compareVersions("28.3", "28.3.3") < 0);
  assert(compareVersions("28.10.0", "28.9.0") > 0);
});

Deno.test("a date becomes an age, and an unusable one becomes nothing", () => {
  assertEquals(daysSince("2026-11-06", NOW), 10);
  assertEquals(daysSince(undefined, NOW), undefined);
  assertEquals(daysSince("not a date", NOW), undefined);
});

Deno.test("facts are read whatever the shell put at the head of them", () => {
  // PowerShell writes a byte-order mark into a pipe on some computers and
  // not on others: it passed here and failed on a Windows CI runner with
  // "Unexpected token" and nothing else to go on.
  const facts = '{"platform":"windows","port":8080}';
  assertEquals(parseFacts(facts).port, 8080);
  assertEquals(parseFacts(`\uFEFF${facts}`).port, 8080);
  assertEquals(parseFacts(`  ${facts}\n`).platform, "windows");
  // Nothing readable at all is no facts, rather than a crash.
  assertEquals(parseFacts(""), {});
  assertEquals(parseFacts("not json"), {});
});

Deno.test("a healthy computer is told so, with nothing to do", () => {
  const found = checks(HEALTHY, { databaseReachable: true, migrationsApplied: 58 }, NOW);
  for (const check of found) {
    assertEquals(check.verdict, "ok", `${check.id}: ${check.found}`);
  }
  const report = render(found);
  assertStringIncludes(report, "Nothing to do.");
  assertStringIncludes(report, "safe to paste");
});

Deno.test("an old Docker is something to do, and says why", () => {
  const found = checks({ ...HEALTHY, docker: { engine: "27.5.0" } }, {}, NOW);
  const docker = of(found, "docker")!;
  assertEquals(docker.verdict, "act");
  assertStringIncludes(docker.todo!, "28.3.3");
  assertStringIncludes(docker.todo!, "same network");
});

Deno.test("a door answering beyond this computer is the loudest line there is", () => {
  const found = checks({
    ...HEALTHY,
    listeners: [{ address: "0.0.0.0", port: 8080 }, { address: "127.0.0.1", port: 8080 }],
  }, {}, NOW);
  const door = of(found, "door")!;
  assertEquals(door.verdict, "act");
  assertStringIncludes(door.found, "0.0.0.0:8080");
  assertStringIncludes(door.todo!, "127.0.0.1");
});

Deno.test("Docker Desktop's port setting and the firewall are looked at on Windows", () => {
  const relaxed = checks({
    ...HEALTHY,
    portBinding: "All interfaces",
    firewall: { inboundAllowForDocker: 2 },
  }, {}, NOW);
  assertEquals(of(relaxed, "port-binding")!.verdict, "watch");
  assertStringIncludes(of(relaxed, "port-binding")!.todo!, "Localhost only");
  assertEquals(of(relaxed, "firewall")!.verdict, "watch");
  assertStringIncludes(of(relaxed, "firewall")!.found, "2 inbound rule");

  // Neither is asked about on a computer that has neither.
  const linux = checks({ ...HEALTHY, platform: "linux", portBinding: undefined, firewall: undefined }, {}, NOW);
  assertEquals(of(linux, "port-binding"), undefined);
  assertEquals(of(linux, "firewall"), undefined);
});

Deno.test("Ollama: not running is fine; open to the network is not", () => {
  const without = checks({ ...HEALTHY, ollama: { reachable: false } }, {}, NOW);
  assertEquals(of(without, "ollama")!.verdict, "ok");
  assertStringIncludes(of(without, "ollama")!.found, "cloud models only");

  const open = checks({
    ...HEALTHY,
    ollama: {
      reachable: true,
      noCloud: true,
      listeners: [{ address: "0.0.0.0", port: 11434 }],
      models: [{ name: "sylou-nemo-16k", contextLength: 16384, onGpu: true }],
    },
  }, {}, NOW);
  assertEquals(of(open, "ollama-door")!.verdict, "act");
  assertStringIncludes(of(open, "ollama-door")!.todo!, "no password");
});

Deno.test("a model that does not fit the graphics card, or has no window, is worth a line", () => {
  const found = checks({
    ...HEALTHY,
    ollama: {
      reachable: true,
      noCloud: false,
      listeners: [{ address: "127.0.0.1", port: 11434 }],
      models: [
        { name: "sylou-nemo-16k", contextLength: 16384, onGpu: true },
        { name: "big-one", contextLength: 32768, onGpu: false },
        { name: "plain", onGpu: true },
      ],
    },
  }, {}, NOW);
  assertEquals(of(found, "ollama-cloud")!.verdict, "watch");
  assertStringIncludes(of(found, "ollama-cloud")!.todo!, "OLLAMA_NO_CLOUD");
  const models = of(found, "models")!;
  assertEquals(models.verdict, "watch");
  assertStringIncludes(models.found, "3 listed");
  assertStringIncludes(models.todo!, "sylou models");
});

Deno.test("an install that has never been backed up is told to", () => {
  const never = checks({ ...HEALTHY, lastBackup: undefined }, {}, NOW);
  assertEquals(of(never, "backup")!.verdict, "act");
  assertStringIncludes(of(never, "backup")!.todo!, "sylou backup");

  const stale = checks({ ...HEALTHY, lastBackup: { at: "2026-09-01" } }, {}, NOW);
  assertEquals(of(stale, "backup")!.verdict, "watch");
});

Deno.test("an old release is worth looking at, without asking GitHub", () => {
  const old = checks({ ...HEALTHY, packageDate: "2026-05-01" }, {}, NOW);
  assertEquals(of(old, "release")!.verdict, "watch");
  assertStringIncludes(of(old, "release")!.found, "199 days old");
});

Deno.test("the two kinds of BitLocker are told apart, as A0 had to learn", () => {
  const protectedDisk = checks({ ...HEALTHY, bitLockerProtection: 1 }, {}, NOW);
  assertEquals(of(protectedDisk, "disk")!.verdict, "ok");

  // 7: encrypted, but the key sits unprotected on the disk - which is what a
  // laptop with device encryption waiting to be turned on reports.
  const unprotected = checks({ ...HEALTHY, bitLockerProtection: 7 }, {}, NOW);
  const disk = of(unprotected, "disk")!;
  assertEquals(disk.verdict, "watch");
  assertStringIncludes(disk.found, "protection is off");
  assert(!/encrypted: yes/i.test(disk.found));
  assertStringIncludes(disk.todo!, "whoever holds the laptop");
});

Deno.test("secrets other accounts can read, and a folder that is synced away", () => {
  const found = checks({
    ...HEALTHY,
    secrets: { ownerOnly: false, others: ["BUILTIN\\Administrators", "Everyone"], syncedTo: "OneDrive" },
  }, {}, NOW);
  assertEquals(of(found, "secrets")!.verdict, "act");
  // Who else, by name, so the fix does not start with a search.
  assertStringIncludes(of(found, "secrets")!.found, "BUILTIN\\Administrators, Everyone");
  assertStringIncludes(of(found, "secrets")!.todo!, "sylou setup");
  // The scripts that cannot name them still get the verdict.
  const unnamed = checks({ ...HEALTHY, secrets: { ownerOnly: false, syncedTo: null } }, {}, NOW);
  assertEquals(of(unnamed, "secrets")!.found, "readable by more than your account");
  assertEquals(of(found, "synced")!.verdict, "act");
  assertStringIncludes(of(found, "synced")!.todo!, "another computer");
});

Deno.test("a database that does not answer is a line of its own", () => {
  const down = checks(HEALTHY, { databaseReachable: false }, NOW);
  assertEquals(of(down, "database")!.verdict, "act");
  assertStringIncludes(of(down, "database")!.todo!, "sylou logs db");
});

Deno.test("nothing that looks like a secret survives the report", () => {
  const secrets = [
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.Zm9vYmFyYmF6cXV4",
    "sb_publishable_AbCdEf123456789",
    "Kq8vZ2mN4pLx7Rt1YbGh3Wd5Fs9Jc0Ae",
    "postgres://authenticator:Hs82kdMq01xZ@db:5432/postgres",
  ];
  for (const secret of secrets) {
    const hidden = redact(`found ${secret} here`);
    assert(!hidden.includes(secret), `redact let this through: ${secret}`);
    assertStringIncludes(hidden, "[hidden]");
  }
  // Ordinary words, versions and paths are left alone - and so is a
  // migration's own name, which is as long as a secret and worth reading.
  const plain = "engine 28.3.3, 127.0.0.1:8080, C:\\sylou-local\\config, 58 migrations applied";
  assertEquals(redact(plain), plain);
  const version = "20261106130000_project-stats-read-only-for-users";
  assertEquals(redact(`latest ${version}`), `latest ${version}`);
});

Deno.test("a secret that reached the facts is still not printed", () => {
  const found = checks({
    ...HEALTHY,
    docker: { engine: "28.3.3" },
    secrets: { path: "C:\\sylou\\config\\secrets", ownerOnly: true, syncedTo: null },
    ollama: {
      reachable: true,
      noCloud: true,
      listeners: [{ address: "127.0.0.1", port: 11434 }],
      // Someone's idea of a model name, with a key in it.
      models: [{ name: "sb_publishable_AbCdEf123456789", contextLength: 8192, onGpu: true }],
    },
  }, {}, NOW);
  const report = render(found);
  assert(!report.includes("sb_publishable_AbCdEf123456789"), "a secret reached the report");
});

Deno.test("the report counts what is left, and says what it is safe for", () => {
  const found = checks({ ...HEALTHY, lastBackup: undefined, packageDate: "2026-01-01" }, {}, NOW);
  const report = render(found);
  assertStringIncludes(report, "1 to do, 1 to look at.");
  assertStringIncludes(report, "safe to paste");
  assertStringIncludes(report, "[ do ]");
  assertStringIncludes(report, "[ hm ]");
});
