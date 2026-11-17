// `sylou setup`, run for real against a stand-in for Docker.
//
// The two things only a real run can show are the ones A0 was bitten by: that
// the install's folder ends up readable by its owner after it is locked down
// (on Windows the obvious one-line way leaves every file readable by nobody),
// and that a folder inside OneDrive, iCloud, Dropbox or Google Drive stops
// setup rather than quietly copying the database and this install's secrets
// to another computer (T44).
//
// On Windows this runs sylou.cmd, which is how the release is used; elsewhere
// it runs ./sylou. The fake docker records what it was asked for.
//
// Run with: deno task test  (from sylou-local/)
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";
import { FAKE_MODEL, FAKE_VERSION, FAKE_WINDOW, fakeOllama } from "./fake-ollama.ts";

const PACKAGE_DIR = fromFileUrl(new URL("../", import.meta.url));
const WINDOWS = Deno.build.os === "windows";
const SECRET_VALUE = "SECRET-VALUE-THAT-MUST-NEVER-BE-PRINTED";

const SECRET_FILES = [
  "jwt_secret",
  "anon_key",
  "service_role_key",
  "pg_supabase_admin_password",
  "pg_postgres_password",
  "pg_authenticator_password",
  "pg_auth_admin_password",
  "pg_storage_admin_password",
  "pgrst_db_uri",
];

/** A Docker that writes a log of what it was asked, and makes the secrets. */
const FAKE_DOCKER = `
const log = Deno.env.get("FAKE_DOCKER_LOG");
if (log) Deno.writeTextFileSync(log, Deno.args.join(" ") + "\\n", { append: true });

if (Deno.args[0] === "version") {
  console.log("28.3.3");
  Deno.exit(0);
}

// docker run --rm -v <folder>:/out <image> secrets
if (Deno.args[0] === "run" && Deno.args.includes("secrets")) {
  const mount = Deno.args[Deno.args.indexOf("-v") + 1] ?? "";
  // "<folder>:/out", except under a POSIX shell on Windows, which rewrites
  // it to "<folder>;C:/out" on its way through.
  const folder = mount.includes(";") ? mount.slice(0, mount.indexOf(";")) : mount.slice(0, mount.lastIndexOf(":"));
  const names = ${JSON.stringify(SECRET_FILES)};
  for (const name of names) Deno.writeTextFileSync(folder + "/" + name, ${JSON.stringify(SECRET_VALUE)} + "-" + name);
  for (const name of ["anthropic_api_key", "mistral_api_key", "deepseek_api_key", "brave_search_api_key"]) {
    Deno.writeTextFileSync(folder + "/" + name, "");
  }
  console.log("secrets: 13 files written to /out");
  Deno.exit(0);
}

// docker compose run --rm -v <file>:/facts.json:ro tools doctor
if (Deno.args.includes("doctor")) {
  // "<host file>:/facts.json:ro" - and the host side carries a drive letter
  // with a colon of its own, so the read-only suffix comes off first.
  const mount = (Deno.args[Deno.args.indexOf("-v") + 1] ?? "").replace(/:(ro|rw)$/, "");
  const from = mount.includes(";") ? mount.slice(0, mount.indexOf(";")) : mount.slice(0, mount.lastIndexOf(":"));
  const facts = Deno.env.get("FAKE_DOCKER_FACTS");
  if (facts && from) Deno.copyFileSync(from, facts);
  console.log("doctor: the facts were read");
  Deno.exit(0);
}

if (Deno.args.includes("add-user")) {
  console.log("add-user: open this once, in your browser:");
  console.log("  http://localhost:8080/auth/v1/verify?token=fake&type=recovery");
  Deno.exit(0);
}

Deno.exit(0);
`;

interface Install {
  dir: string;
  log: string;
  /** Where the fake docker writes what `doctor` handed it on stdin. */
  facts: string;
  binDir: string;
  port: number;
}

/** A port nothing is listening on, so these tests do not mind what is. */
function freePort(): number {
  const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

/** A copy of the package, with a fake docker to find on the path. */
// The folder's name has a space in it on purpose: an install may sit in
// "My Writing", and a path that is not quoted somewhere would break there
// and nowhere else.
async function stagedInstall(folderName = "sylou local", port = freePort()): Promise<Install> {
  const root = await Deno.makeTempDir({ prefix: "sylou-scripts-" });
  const dir = join(root, folderName);
  await Deno.mkdir(dir, { recursive: true });
  for (const name of ["sylou", "sylou.ps1", "sylou.cmd", "compose.yaml", "compose.local-only.yaml", "settings.example.env", "VERSION"]) {
    await Deno.copyFile(join(PACKAGE_DIR, name), join(dir, name));
  }
  if (!WINDOWS) await Deno.chmod(join(dir, "sylou"), 0o755);

  // The settings this install starts with, so the tests do not depend on
  // what happens to be listening on the example file's port.
  await Deno.mkdir(join(dir, "config"), { recursive: true });
  await Deno.writeTextFile(
    join(dir, "config", "settings.env"),
    [`SYLOU_PORT=${port}`, "SYLOU_IMAGE_TAG=dev", "SYLOU_INSTANCE_LABEL=local", ""].join("\n"),
  );

  const binDir = join(root, "bin");
  await Deno.mkdir(binDir);
  const fake = join(binDir, "fake-docker.ts");
  await Deno.writeTextFile(fake, FAKE_DOCKER);
  // Both, always: on Windows the shell script is run as well when a POSIX
  // shell is there, and it needs a docker it can run too.
  await Deno.writeTextFile(join(binDir, "docker.cmd"), `@echo off\r\ndeno run --allow-all "${fake}" %*\r\n`);
  await Deno.writeTextFile(join(binDir, "docker"), `#!/bin/sh\nexec deno run --allow-all "${posix(fake)}" "$@"\n`);
  if (!WINDOWS) await Deno.chmod(join(binDir, "docker"), 0o755);

  return { dir, log: join(root, "docker.log"), facts: join(root, "facts.json"), binDir, port };
}

/** C:\a\b as a POSIX shell on Windows wants it: /c/a/b. */
function posix(path: string): string {
  const drive = path.match(/^([A-Za-z]):[\\/]/);
  if (!drive) return path;
  return `/${drive[1].toLowerCase()}/${path.slice(3).replace(/\\/g, "/")}`;
}

/**
 * What a Windows PowerShell 5.1 started from PowerShell 7 inherits: PowerShell
 * 7's module folders first in PSModulePath, holding a Microsoft.PowerShell.
 * Security that 5.1 cannot load. Every step on a GitHub Windows runner runs in
 * PowerShell 7, and so does a PowerShell 7 window on anyone's computer. A
 * stand-in module of that name, marked as needing PowerShell 7, recreates it
 * here, so a script that leans on that module fails on this machine too.
 */
async function pwsh7ModulePath(root: string): Promise<Record<string, string>> {
  // Laid out where PowerShell 7 keeps its own: ...\PowerShell\7\Modules.
  const modules = join(root, "PowerShell", "7", "Modules");
  const module = join(modules, "Microsoft.PowerShell.Security");
  await Deno.mkdir(module, { recursive: true });
  await Deno.writeTextFile(
    join(module, "Microsoft.PowerShell.Security.psd1"),
    [
      "@{",
      "    ModuleVersion = '7.4.0.0'",
      "    GUID = 'a94c8c7e-9810-47c0-b8af-65089c13a35a'",
      "    PowerShellVersion = '7.0'",
      "    CompatiblePSEditions = @('Core')",
      "    CmdletsToExport = @('Get-Acl', 'Set-Acl')",
      "}",
      "",
    ].join("\r\n"),
  );
  return { PSModulePath: `${modules};${Deno.env.get("PSModulePath") ?? ""}` };
}

/** Is there a POSIX shell to run the other script with? */
async function haveSh(): Promise<boolean> {
  try {
    const result = await new Deno.Command("sh", { args: ["-c", "exit 0"], stdout: "null", stderr: "null" }).output();
    return result.success;
  } catch {
    return false;
  }
}

async function runSylou(
  install: Install,
  args: string[],
  shell: "native" | "sh" = "native",
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; out: string }> {
  const command = WINDOWS && shell === "native"
    ? new Deno.Command("cmd.exe", {
      args: ["/c", join(install.dir, "sylou.cmd"), ...args],
      cwd: install.dir,
      env: {
        PATH: `${install.binDir};${Deno.env.get("PATH")}`,
        FAKE_DOCKER_LOG: install.log,
        FAKE_DOCKER_FACTS: install.facts,
        ...extraEnv,
      },
      stdout: "piped",
      stderr: "piped",
    })
    : new Deno.Command("sh", {
      args: [posix(join(install.dir, "sylou")), ...args],
      cwd: install.dir,
      env: {
        PATH: `${WINDOWS ? posix(install.binDir) : install.binDir}:${Deno.env.get("PATH")}`,
        FAKE_DOCKER_LOG: WINDOWS ? posix(install.log) : install.log,
        FAKE_DOCKER_FACTS: WINDOWS ? posix(install.facts) : install.facts,
        HOME: Deno.env.get("HOME") ?? "",
      },
      stdout: "piped",
      stderr: "piped",
    });
  const result = await command.output();
  const decoder = new TextDecoder();
  return { code: result.code, out: decoder.decode(result.stdout) + decoder.decode(result.stderr) };
}

const runSetup = (install: Install, args: string[], shell: "native" | "sh" = "native") =>
  runSylou(install, ["setup", ...args], shell);

Deno.test("setup makes the install, and its secrets stay readable by their owner", async () => {
  const install = await stagedInstall();
  try {
    const { code, out } = await runSetup(install, ["you@example.com"]);
    assertEquals(code, 0, out);

    // The settings are the example file, copied for editing.
    const settings = await Deno.readTextFile(join(install.dir, "config", "settings.env"));
    assertStringIncludes(settings, `SYLOU_PORT=${install.port}`);

    // The A0 trap: after the folder is locked to one account, every file in
    // it must still be readable — the one-line icacls way leaves them
    // readable by nobody at all.
    for (const name of SECRET_FILES) {
      const value = await Deno.readTextFile(join(install.dir, "config", "secrets", name));
      assertStringIncludes(value, "-" + name);
    }

    // It started the stack and made the account.
    const log = await Deno.readTextFile(install.log);
    assertStringIncludes(log, "up -d --wait");
    assertStringIncludes(log, "add-user you@example.com");

    // And said where Sylou is, without printing a single secret.
    assertStringIncludes(out, `http://localhost:${install.port}`);
    assert(!out.includes(SECRET_VALUE), "setup printed a secret");
  } finally {
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

Deno.test("a folder inside OneDrive, iCloud, Dropbox or Google Drive stops setup", async () => {
  const install = await stagedInstall(join("OneDrive", "sylou-local"));
  try {
    const { code, out } = await runSetup(install, ["you@example.com"]);
    assertEquals(code, 1, out);
    assertStringIncludes(out, "OneDrive");
    assertStringIncludes(out, "another computer");

    // Nothing was started, and no secret was made.
    const log = await Deno.readTextFile(install.log).catch(() => "");
    assert(!log.includes("up -d"), "setup started Sylou in a synced folder");
    assert(!log.includes("secrets"), "setup made this install's secrets in a synced folder");
  } finally {
    await Deno.remove(join(install.dir, "..", ".."), { recursive: true });
  }
});

Deno.test("…unless you say you know better, and then it carries on", async () => {
  const install = await stagedInstall(join("Dropbox", "sylou-local"));
  try {
    const { code, out } = await runSetup(install, ["you@example.com", "--allow-synced-folder"]);
    assertEquals(code, 0, out);
    assertStringIncludes(out, "Dropbox");
    const log = await Deno.readTextFile(install.log);
    assertStringIncludes(log, "up -d --wait");
  } finally {
    await Deno.remove(join(install.dir, "..", ".."), { recursive: true });
  }
});

// The shell script is what macOS and Linux run, and only a Linux runner
// would otherwise ever run it: a Windows machine with a POSIX shell (Git for
// Windows has one) runs it here too, so a mistake in it is found where it is
// written rather than on CI.
Deno.test({
  name: "the shell script sets an install up in the same way",
  ignore: !(await haveSh()),
  fn: async () => {
    const install = await stagedInstall();
    try {
      const { code, out } = await runSetup(install, ["you@example.com"], "sh");
      assertEquals(code, 0, out);
      for (const name of SECRET_FILES) {
        assertStringIncludes(await Deno.readTextFile(join(install.dir, "config", "secrets", name)), "-" + name);
      }
      const log = await Deno.readTextFile(install.log);
      assertStringIncludes(log, "up -d --wait");
      assertStringIncludes(log, "add-user you@example.com");
      assert(!out.includes(SECRET_VALUE), "setup printed a secret");
    } finally {
      await Deno.remove(join(install.dir, ".."), { recursive: true });
    }
  },
});

// On a Linux engine a container's own user may not write into a folder of
// yours, and Docker hands each secret file to its container as the file
// itself: so the one-shots that write into your folders run as you, and the
// files stay readable inside a folder only you may open.
Deno.test({
  name: "the shell script's one-shots write into your folders as you, behind a folder only you may open",
  ignore: !(await haveSh()),
  fn: async () => {
    const install = await stagedInstall();
    const into = await Deno.makeTempDir({ prefix: "sylou-backups-" });
    try {
      assertEquals((await runSetup(install, ["you@example.com"], "sh")).code, 0);
      const backup = await runSylou(install, ["backup", WINDOWS ? posix(into) : into], "sh");
      assertEquals(backup.code, 0, backup.out);

      const id = await new Deno.Command("sh", { args: ["-c", 'printf "%s:%s" "$(id -u)" "$(id -g)"'], stdout: "piped" })
        .output();
      const you = new TextDecoder().decode(id.stdout);
      const log = (await Deno.readTextFile(install.log)).split("\n");
      const secrets = log.find((line) => line.startsWith("run ") && line.endsWith(" secrets")) ?? "";
      const dump = log.find((line) => line.endsWith(" dump")) ?? "";
      assertStringIncludes(secrets, `--user ${you}`);
      assertStringIncludes(dump, `--user ${you}`);

      if (!WINDOWS) {
        const mode = (path: string) => (Deno.statSync(path).mode ?? 0) & 0o777;
        assertEquals(mode(join(install.dir, "config")), 0o700);
        assertEquals(mode(join(install.dir, "config", "secrets")), 0o700);
        assertEquals(mode(join(install.dir, "config", "secrets", "jwt_secret")), 0o644);
      }
    } finally {
      await Deno.remove(into, { recursive: true });
      await Deno.remove(join(install.dir, ".."), { recursive: true });
    }
  },
});

Deno.test("setup stops when something else is already on the port", async () => {
  const port = freePort();
  const taken = Deno.listen({ hostname: "127.0.0.1", port });
  const install = await stagedInstall("sylou-local", port);
  try {
    const { code, out } = await runSetup(install, ["you@example.com"]);
    assertEquals(code, 1, out);
    assertStringIncludes(out, String(port));
    assertStringIncludes(out, "settings.env");
    const log = await Deno.readTextFile(install.log).catch(() => "");
    assert(!log.includes("up -d"), "setup started Sylou on a port that was taken");
  } finally {
    taken.close();
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

// Compose reads config/settings.env itself (`--env-file`), and the commands
// read it too: a value in quotes, or one with a comment after it, has to mean
// the same thing to both, or setup checks one port while Compose publishes
// another.
Deno.test("a setting in quotes, or with a comment after it, reads as Compose reads it", async () => {
  for (const shell of WINDOWS && !(await haveSh()) ? ["native"] as const : ["native", "sh"] as const) {
    const install = await stagedInstall();
    try {
      await Deno.writeTextFile(
        join(install.dir, "config", "settings.env"),
        [
          `SYLOU_PORT="${install.port}"   # the port this install answers on`,
          "SYLOU_IMAGE_TAG='dev'",
          "SYLOU_INSTANCE_LABEL=local # shown in the app",
          "",
        ].join("\n"),
      );
      const { code, out } = await runSetup(install, ["you@example.com"], shell);
      assertEquals(code, 0, `${shell}: ${out}`);
      assertStringIncludes(out, `127.0.0.1:${install.port} is free.`);
      // The tag reads as dev, so setup builds the images from this checkout.
      assertStringIncludes(await Deno.readTextFile(install.log), " build", `${shell} did not build`);
    } finally {
      await Deno.remove(join(install.dir, ".."), { recursive: true });
    }
  }
});

// `doctor` is two halves: the script gathers what only this computer can see
// and the tools image decides what it means. This is the first half - that
// the facts arrive at all, that they are about this install, and that nothing
// secret travels with them.
Deno.test("doctor hands the computer's own facts to the tools image", async () => {
  const install = await stagedInstall();
  try {
    const setup = await runSetup(install, ["you@example.com"]);
    assertEquals(setup.code, 0, setup.out);
    // On Windows, as the CI runner and a PowerShell 7 window both run it.
    const extra = WINDOWS ? await pwsh7ModulePath(join(install.dir, "..")) : {};
    const { code, out } = await runSylou(install, ["doctor"], "native", extra);
    assertEquals(code, 0, out);

    // Tolerated on the way in, refused on the way out: the tools image drops
    // a byte-order mark if one arrives, and the script must not send one -
    // PowerShell writes one into a pipe on some computers and not others,
    // which is how a green suite here failed on a Windows CI runner with
    // nothing but "Unexpected token" to go on.
    const raw = await Deno.readTextFile(install.facts);
    assert(!raw.startsWith("\uFEFF"), "the script put a byte-order mark at the head of the facts");
    const facts = JSON.parse(raw.replace(/^\uFEFF/, ""));
    assertEquals(facts.platform, WINDOWS ? "windows" : Deno.build.os === "darwin" ? "macos" : "linux");
    assertEquals(facts.port, install.port);
    assertEquals(typeof facts.docker, "object");
    assertEquals(facts.docker.engine, "28.3.3");
    assert(Array.isArray(facts.listeners), "the listening addresses were not gathered");
    // When the two disagree, both accounts of it: who doctor found, and what
    // setup said while it locked the folder.
    assertEquals(
      facts.secrets.ownerOnly,
      true,
      `setup locked the folder, and doctor should see that\ndoctor: ${JSON.stringify(facts.secrets)}\nsetup:\n${setup.out}`,
    );
    assertEquals(facts.secrets.syncedTo, null);
    assertEquals(facts.packageVersion, "dev");

    // The facts travel past the secrets without picking any up.
    const asText = JSON.stringify(facts);
    assert(!asText.includes(SECRET_VALUE), "a secret travelled with doctor's facts");
  } finally {
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

/** Whether nothing is listening on a port of this computer's loopback. */
function portIsFree(port: number): boolean {
  try {
    Deno.listen({ hostname: "127.0.0.1", port }).close();
    return true;
  } catch {
    return false;
  }
}

/** What a real Ollama on this computer says its version is, if one answers. */
async function realOllamaVersion(): Promise<string | undefined> {
  try {
    const answer = await fetch("http://127.0.0.1:11434/api/version", { signal: AbortSignal.timeout(3000) });
    return (await answer.json()).version;
  } catch {
    return undefined;
  }
}

// Doctor's Ollama lines are made from what the script asks Ollama on this
// computer, at the address Ollama itself uses: its version, and the window of
// each listed model. A stand-in answers there - or, where a real Ollama
// already holds the port, the facts must carry what that one says.
Deno.test("doctor hands Ollama's version and the models' windows to the tools image", async () => {
  const real = !portIsFree(11434);
  const expected = real ? await realOllamaVersion() : FAKE_VERSION;
  // Something that is not Ollama holds the port: there is nothing to compare.
  if (!expected) return;
  const ollama = real ? undefined : Deno.serve({ hostname: "127.0.0.1", port: 11434, onListen() {} }, fakeOllama());
  const install = await stagedInstall();
  try {
    await Deno.writeTextFile(
      join(install.dir, "config", "settings.env"),
      `OLLAMA_URL=http://host.docker.internal:11434\nOLLAMA_MODELS=${FAKE_MODEL}\n`,
      { append: true },
    );
    for (const shell of WINDOWS && !(await haveSh()) ? ["native"] as const : ["native", "sh"] as const) {
      const { code, out } = await runSylou(install, ["doctor"], shell);
      assertEquals(code, 0, `${shell}: ${out}`);
      const facts = JSON.parse((await Deno.readTextFile(install.facts)).replace(/^\uFEFF/, ""));
      assertEquals(facts.ollama?.reachable, true, `${shell}: ${JSON.stringify(facts.ollama)}`);
      assertEquals(facts.ollama.version, expected, `${shell}: ${JSON.stringify(facts.ollama)}`);
      assertEquals(facts.ollama.models?.[0]?.name, FAKE_MODEL, shell);
      // Only the stand-in knows this model, and the window it was made with.
      if (!real) assertEquals(facts.ollama.models[0].contextLength, FAKE_WINDOW, shell);
    }
  } finally {
    await ollama?.shutdown();
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

// The condition a GitHub Windows runner showed: the folder already lets SYSTEM
// and Administrators in, through entries that icacls's /inheritance:r leaves
// in place while reporting success. Setup has to lock it all the same.
Deno.test({
  name: "setup locks a folder that already lets SYSTEM and Administrators in",
  ignore: !WINDOWS,
  fn: async () => {
    const install = await stagedInstall();
    try {
      const grant = await new Deno.Command("cmd.exe", {
        args: ["/c", "icacls", join(install.dir, "config"), "/grant", "*S-1-5-18:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(grant.success, new TextDecoder().decode(grant.stderr));

      const setup = await runSetup(install, ["you@example.com"]);
      assertEquals(setup.code, 0, setup.out);
      assertStringIncludes(setup.out, "readable by your account only");
      const { code, out } = await runSylou(install, ["doctor"]);
      assertEquals(code, 0, out);
      const secrets = JSON.parse((await Deno.readTextFile(install.facts)).replace(/^\uFEFF/, "")).secrets;
      assertEquals(secrets.ownerOnly, true, JSON.stringify(secrets));
      assertEquals(secrets.others, []);
    } finally {
      await Deno.remove(join(install.dir, ".."), { recursive: true });
    }
  },
});

// What doctor tells someone whose secrets another account can open, and that
// its advice - run setup again - takes the folder back.
Deno.test({
  name: "doctor names another account that can open the secrets, and setup takes the folder back",
  ignore: !WINDOWS,
  fn: async () => {
    const install = await stagedInstall();
    const secrets = join(install.dir, "config", "secrets");
    const doctorSees = async () => {
      const { code, out } = await runSylou(install, ["doctor"]);
      assertEquals(code, 0, out);
      return JSON.parse((await Deno.readTextFile(install.facts)).replace(/^\uFEFF/, "")).secrets;
    };
    try {
      assertEquals((await runSetup(install, ["you@example.com"])).code, 0);

      // Everyone (S-1-1-0, whatever Windows calls it in its own language)
      // may now read the folder.
      const grant = await new Deno.Command("cmd.exe", {
        args: ["/c", "icacls", secrets, "/grant", "*S-1-1-0:R"],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assert(grant.success, new TextDecoder().decode(grant.stderr));

      const open = await doctorSees();
      assertEquals(open.ownerOnly, false, JSON.stringify(open));
      assertEquals(open.others.length, 1, JSON.stringify(open));

      const again = await runSetup(install, ["you@example.com"]);
      assertEquals(again.code, 0, again.out);
      assertStringIncludes(again.out, "readable by your account only");
      const closed = await doctorSees();
      assertEquals(closed.ownerOnly, true, JSON.stringify(closed));
      assertEquals(closed.others, []);
    } finally {
      await Deno.remove(join(install.dir, ".."), { recursive: true });
    }
  },
});

Deno.test("backup makes a folder of its own, and leaves a note of when", async () => {
  const install = await stagedInstall();
  const into = await Deno.makeTempDir({ prefix: "sylou-backups-" });
  try {
    assertEquals((await runSetup(install, ["you@example.com"])).code, 0);
    const { code, out } = await runSylou(install, ["backup", into]);
    assertEquals(code, 0, out);

    // One folder per backup, named for the day and the minute.
    const made = [...Deno.readDirSync(into)].map((entry) => entry.name);
    assertEquals(made.length, 1);
    assert(/^sylou-\d{4}-\d{2}-\d{2}-\d{4}$/.test(made[0]), `odd folder name: ${made[0]}`);

    // It ran the one-shot that holds pg_dump, with that folder mounted.
    const log = await Deno.readTextFile(install.log);
    assertStringIncludes(log, "run --rm -v");
    assertStringIncludes(log, "dump");

    // And doctor can now say how long ago the last backup was.
    const note = JSON.parse(await Deno.readTextFile(join(install.dir, "config", "last-backup.json")));
    assert(Date.now() - Date.parse(note.at) < 120_000, `the note says ${note.at}`);
    assertStringIncludes(note.path, made[0]);

    // And it says what a backup does not hold.
    assertStringIncludes(out, "secrets are not in it");
  } finally {
    await Deno.remove(into, { recursive: true });
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

Deno.test("restore refuses a folder that is not a backup, and changes nothing", async () => {
  const install = await stagedInstall();
  const empty = await Deno.makeTempDir({ prefix: "sylou-not-a-backup-" });
  try {
    assertEquals((await runSetup(install, ["you@example.com"])).code, 0);
    await Deno.truncate(install.log, 0);

    const { code, out } = await runSylou(install, ["restore", empty, "--yes"]);
    assertEquals(code, 1, out);
    assertStringIncludes(out, "data.sql");

    const log = await Deno.readTextFile(install.log);
    assert(!log.includes("load"), "it started the restore anyway");
  } finally {
    await Deno.remove(empty, { recursive: true });
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

Deno.test("local-only on and off write the setting and start again with it", async () => {
  const install = await stagedInstall();
  const settingsFile = join(install.dir, "config", "settings.env");
  try {
    assertEquals((await runSetup(install, ["you@example.com"])).code, 0);
    await Deno.truncate(install.log, 0);

    const on = await runSylou(install, ["local-only", "on"]);
    assertEquals(on.code, 0, on.out);
    assertStringIncludes(await Deno.readTextFile(settingsFile), "SYLOU_LOCAL_ONLY=true");
    assertStringIncludes(on.out, "Ollama on this computer");
    // Started again with the file that takes the functions' way out away,
    // and with the relay the mode needs.
    const afterOn = await Deno.readTextFile(install.log);
    assertStringIncludes(afterOn, "compose.local-only.yaml");
    assertStringIncludes(afterOn, "--profile local-only");
    assertStringIncludes(afterOn, "--remove-orphans");

    await Deno.truncate(install.log, 0);
    const off = await runSylou(install, ["local-only", "off"]);
    assertEquals(off.code, 0, off.out);
    assertStringIncludes(await Deno.readTextFile(settingsFile), "SYLOU_LOCAL_ONLY=");
    assert(!/SYLOU_LOCAL_ONLY=true/.test(await Deno.readTextFile(settingsFile)));
    const afterOff = await Deno.readTextFile(install.log);
    // A service kept behind a profile is not an orphan, so the relay has to
    // be taken away by name - found by running it, where --remove-orphans
    // left it going.
    assertStringIncludes(afterOff, "rm -s -f relay");
    // And the install itself starts again without the local-only file.
    const started = afterOff.trim().split("\n").filter((line) => line.includes("up -d --wait")).pop() ?? "";
    assert(!started.includes("compose.local-only.yaml"), `it stayed in local-only mode: ${started}`);
    assertStringIncludes(started, "--remove-orphans");
  } finally {
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

Deno.test("local-only says which, rather than guessing", async () => {
  const install = await stagedInstall();
  try {
    assertEquals((await runSetup(install, ["you@example.com"])).code, 0);
    const { code, out } = await runSylou(install, ["local-only"]);
    assertEquals(code, 1, out);
    assertStringIncludes(out, "local-only on");
  } finally {
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

Deno.test("remove takes the volumes, and only when it is answered", async () => {
  const install = await stagedInstall();
  try {
    assertEquals((await runSetup(install, ["you@example.com"])).code, 0);
    await Deno.truncate(install.log, 0);

    const { code, out } = await runSylou(install, ["remove", "--yes"]);
    assertEquals(code, 0, out);
    const log = await Deno.readTextFile(install.log);
    assertStringIncludes(log, "down -v --remove-orphans");
    // The settings and the secrets are not its business.
    assert(await Deno.stat(join(install.dir, "config", "secrets", "jwt_secret")).then(() => true).catch(() => false));
  } finally {
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});

Deno.test("the Windows scripts hold no character Windows PowerShell would misread", async () => {
  // Windows PowerShell 5.1 reads a .ps1 without a byte-order mark in the
  // computer's own code page, not as UTF-8. An em dash then arrives as three
  // characters, one of them a curly quote, which opens a string that never
  // ends: the whole script fails to parse, with an error pointing at an
  // innocent line 100 lines further down. Plain ASCII, and it cannot happen.
  for (const name of ["sylou.ps1", "sylou.cmd", "sylou"]) {
    const bytes = await Deno.readFile(join(PACKAGE_DIR, name));
    const offending = bytes.findIndex((byte) => byte > 127);
    assertEquals(offending, -1, `${name} has a byte outside ASCII at ${offending}`);
  }
});

Deno.test("setup run again keeps the secrets the install already has", async () => {
  const install = await stagedInstall();
  try {
    assertEquals((await runSetup(install, ["you@example.com"])).code, 0);
    const first = await Deno.readTextFile(join(install.dir, "config", "secrets", "jwt_secret"));

    const second = await runSetup(install, ["you@example.com"]);
    assertEquals(second.code, 0, second.out);
    assertStringIncludes(second.out, "already has its secrets");
    assertEquals(await Deno.readTextFile(join(install.dir, "config", "secrets", "jwt_secret")), first);
  } finally {
    await Deno.remove(join(install.dir, ".."), { recursive: true });
  }
});
