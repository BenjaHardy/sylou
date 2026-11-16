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
  const folder = mount.slice(0, mount.lastIndexOf(":"));
  const names = ${JSON.stringify(SECRET_FILES)};
  for (const name of names) Deno.writeTextFileSync(folder + "/" + name, ${JSON.stringify(SECRET_VALUE)} + "-" + name);
  for (const name of ["anthropic_api_key", "mistral_api_key", "deepseek_api_key", "brave_search_api_key"]) {
    Deno.writeTextFileSync(folder + "/" + name, "");
  }
  console.log("secrets: 13 files written to /out");
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
  binDir: string;
}

/** A copy of the package, with a fake docker to find on the path. */
async function stagedInstall(folderName = "sylou-local"): Promise<Install> {
  const root = await Deno.makeTempDir({ prefix: "sylou-scripts-" });
  const dir = join(root, folderName);
  await Deno.mkdir(dir, { recursive: true });
  for (const name of ["sylou", "sylou.ps1", "sylou.cmd", "compose.yaml", "compose.local-only.yaml", "settings.example.env"]) {
    await Deno.copyFile(join(PACKAGE_DIR, name), join(dir, name));
  }
  if (!WINDOWS) await Deno.chmod(join(dir, "sylou"), 0o755);

  const binDir = join(root, "bin");
  await Deno.mkdir(binDir);
  const fake = join(binDir, "fake-docker.ts");
  await Deno.writeTextFile(fake, FAKE_DOCKER);
  if (WINDOWS) {
    await Deno.writeTextFile(join(binDir, "docker.cmd"), `@echo off\r\ndeno run --allow-all "${fake}" %*\r\n`);
  } else {
    await Deno.writeTextFile(join(binDir, "docker"), `#!/bin/sh\nexec deno run --allow-all "${fake}" "$@"\n`);
    await Deno.chmod(join(binDir, "docker"), 0o755);
  }

  return { dir, log: join(root, "docker.log"), binDir };
}

async function runSetup(install: Install, args: string[]): Promise<{ code: number; out: string }> {
  const command = WINDOWS
    ? new Deno.Command("cmd.exe", {
      args: ["/c", join(install.dir, "sylou.cmd"), "setup", ...args],
      cwd: install.dir,
      env: { PATH: `${install.binDir};${Deno.env.get("PATH")}`, FAKE_DOCKER_LOG: install.log },
      stdout: "piped",
      stderr: "piped",
    })
    : new Deno.Command("sh", {
      args: [join(install.dir, "sylou"), "setup", ...args],
      cwd: install.dir,
      env: { PATH: `${install.binDir}:${Deno.env.get("PATH")}`, FAKE_DOCKER_LOG: install.log, HOME: Deno.env.get("HOME") ?? "" },
      stdout: "piped",
      stderr: "piped",
    });
  const result = await command.output();
  const decoder = new TextDecoder();
  return { code: result.code, out: decoder.decode(result.stdout) + decoder.decode(result.stderr) };
}

Deno.test("setup makes the install, and its secrets stay readable by their owner", async () => {
  const install = await stagedInstall();
  try {
    const { code, out } = await runSetup(install, ["you@example.com"]);
    assertEquals(code, 0, out);

    // The settings are the example file, copied for editing.
    const settings = await Deno.readTextFile(join(install.dir, "config", "settings.env"));
    assertStringIncludes(settings, "SYLOU_PORT=8080");

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
    assertStringIncludes(out, "http://localhost:8080");
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
