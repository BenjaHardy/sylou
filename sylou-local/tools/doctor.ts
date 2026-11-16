// `sylou doctor`: one look at this install and the computer around it.
//
// The script on your computer gathers the facts only it can see - what Docker
// says, which addresses are listened on, what the firewall allows, whether
// the disk is encrypted, who may read the secrets - and hands them here as
// JSON. This file decides what each fact means and writes the lines, so there
// is one set of rules and one place to test them (D4).
//
// Every line says what was looked at, why it matters and what to do. Nothing
// shaped like a secret is ever printed, and the report ends by saying so, in
// as many words, because its whole purpose is to be pasted into an issue.

/** What the script on the computer found. Everything is optional: a check it
 * could not make says so rather than guessing. */
export interface HostFacts {
  platform?: "windows" | "macos" | "linux";
  packageVersion?: string;
  /** The release's own date, so the age needs no call to GitHub (D10). */
  packageDate?: string;
  docker?: { engine?: string; compose?: string; desktop?: string };
  /** Docker Desktop's "Port binding behavior", when it could be read. */
  portBinding?: string;
  /** Everything listening, as the computer sees it. */
  listeners?: { address: string; port: number; process?: string }[];
  /** Windows only: inbound Allow rules for Docker, Ollama or WSL. */
  firewall?: { inboundAllowForDocker?: number; defaultInbound?: string };
  /** 1 = protected, 7 = encrypted but protection off (A0, Windows). */
  bitLockerProtection?: number;
  diskEncryption?: "on" | "off" | "unknown";
  secrets?: { path?: string; ownerOnly?: boolean; syncedTo?: string | null };
  lastBackup?: { at?: string; path?: string };
  ollama?: {
    reachable?: boolean;
    address?: string;
    version?: string;
    noCloud?: boolean;
    models?: { name: string; contextLength?: number; cloud?: boolean; onGpu?: boolean }[];
    listeners?: { address: string; port: number }[];
  };
  /** The port this install answers on. */
  port?: number;
}

/** What doctor itself can see from inside Docker. */
export interface InsideFacts {
  schemaVersion?: string;
  migrationsApplied?: number;
  databaseReachable?: boolean;
}

export type Verdict = "ok" | "watch" | "act";

export interface Check {
  id: string;
  title: string;
  verdict: Verdict;
  /** What was found. */
  found: string;
  /** Why it matters, and what to do - only when something should be done. */
  todo?: string;
}

const MARK: Record<Verdict, string> = { ok: "[ ok ]", watch: "[ hm ]", act: "[ do ]" };

/** The oldest Docker Engine the package is tested against (A0, D5). */
export const MINIMUM_ENGINE = "28.3.3";

/** Compares two dotted versions; -1, 0 or 1. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(/[.+-]/).map((p) => parseInt(p, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

/** Days between a date and now, or undefined when the date is unusable. */
export function daysSince(when: string | undefined, now = Date.now()): number | undefined {
  if (!when) return undefined;
  const then = Date.parse(when);
  if (Number.isNaN(then)) return undefined;
  return Math.floor((now - then) / 86_400_000);
}

/**
 * Anything that looks like a key, a password or a token, hidden. The report
 * is meant to be pasted somewhere public, so this runs over every line,
 * including the ones the facts themselves brought in.
 */
export function redact(text: string): string {
  return text
    // A signed key: three dot-separated chunks of base64.
    .replace(/\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[hidden]")
    // Supabase's publishable and secret keys, and anything else with a
    // provider's prefix.
    .replace(/\b(sb_[a-z]+|sk|pk|rk)_[A-Za-z0-9_-]{6,}\b/g, "[hidden]")
    // A long run of random-looking characters: our own 32- and 64-character
    // secrets, and most provider keys. A migration's own name is just as
    // long and says something worth reading, so it is left as it is.
    .replace(
      /\b(?=[A-Za-z0-9_-]*[0-9])(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g,
      (match) => (/^\d{14}_[a-z0-9-]+$/i.test(match) ? match : "[hidden]"),
    )
    // A connection string with a password in it.
    .replace(/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, "$1[hidden]@");
}

function listenersOutside(listeners: { address: string; port: number }[] | undefined, port?: number) {
  if (!listeners) return undefined;
  const ours = port === undefined ? listeners : listeners.filter((l) => l.port === port);
  return ours.filter((l) => l.address !== "127.0.0.1" && l.address !== "::1");
}

/** Every check, in the order they are printed. */
export function checks(host: HostFacts, inside: InsideFacts = {}, now = Date.now()): Check[] {
  const found: Check[] = [];
  const add = (check: Check) => found.push(check);

  // ---- Docker itself ------------------------------------------------------
  const engine = host.docker?.engine;
  if (!engine) {
    add({
      id: "docker",
      title: "Docker",
      verdict: "act",
      found: "could not be asked for its version",
      todo: "Start Docker and run this again; nothing below it can be checked without it.",
    });
  } else if (compareVersions(engine, MINIMUM_ENGINE) < 0) {
    add({
      id: "docker",
      title: "Docker",
      verdict: "act",
      found: `engine ${engine}, older than the ${MINIMUM_ENGINE} this package is tested with`,
      todo:
        "Update Docker. Before 28.0 a computer on the same network could reach a port published on " +
        "localhost, and 28.3.3 closed a flaw of its own.",
    });
  } else {
    add({ id: "docker", title: "Docker", verdict: "ok", found: `engine ${engine}` });
  }

  // ---- The door -----------------------------------------------------------
  const strayDoor = listenersOutside(host.listeners, host.port);
  if (strayDoor === undefined) {
    add({
      id: "door",
      title: "Sylou's own door",
      verdict: "watch",
      found: "the computer's listening addresses could not be read",
      todo: "Check by hand that Sylou answers on 127.0.0.1 only.",
    });
  } else if (strayDoor.length > 0) {
    add({
      id: "door",
      title: "Sylou's own door",
      verdict: "act",
      found: `answering on ${strayDoor.map((l) => `${l.address}:${l.port}`).join(", ")}, not only on this computer`,
      todo:
        "Stop Sylou, check SYLOU_PORT in config/settings.env, and start it again. An install is meant to " +
        "answer on 127.0.0.1 and nowhere else.",
    });
  } else {
    add({
      id: "door",
      title: "Sylou's own door",
      verdict: "ok",
      found: `127.0.0.1:${host.port ?? 8080}, this computer only`,
    });
  }

  if (host.platform === "windows" && host.portBinding) {
    const localhostOnly = /localhost/i.test(host.portBinding);
    add({
      id: "port-binding",
      title: "Docker Desktop's port binding",
      verdict: localhostOnly ? "ok" : "watch",
      found: host.portBinding,
      todo: localhostOnly
        ? undefined
        : "Docker Desktop → Settings → Resources → Network → Port binding behavior → Localhost only. " +
          "It keeps every container's published port on this computer, whatever the container asked for.",
    });
  }

  if (host.platform === "windows" && host.firewall) {
    const allow = host.firewall.inboundAllowForDocker ?? 0;
    add({
      id: "firewall",
      title: "Windows firewall",
      verdict: allow > 0 ? "watch" : "ok",
      found: allow > 0
        ? `${allow} inbound rule(s) allow Docker, WSL or Ollama from the network`
        : "no inbound rule lets Docker, WSL or Ollama in from the network",
      todo: allow > 0
        ? "Look at those rules in Windows Defender Firewall. A published port on 127.0.0.1 is not reachable " +
          "from the network, but an inbound Allow rule for the program behind it widens what else can be."
        : undefined,
    });
  }

  // ---- Ollama -------------------------------------------------------------
  if (host.ollama) {
    const ollama = host.ollama;
    if (!ollama.reachable) {
      add({
        id: "ollama",
        title: "Models on this computer",
        verdict: "ok",
        found: "Ollama is not running, so Sylou uses cloud models only",
      });
    } else {
      const stray = listenersOutside(ollama.listeners);
      add({
        id: "ollama-door",
        title: "Ollama's own door",
        verdict: stray && stray.length > 0 ? "act" : "ok",
        found: stray && stray.length > 0
          ? `answering on ${stray.map((l) => `${l.address}:${l.port}`).join(", ")}`
          : "127.0.0.1 only",
        todo: stray && stray.length > 0
          ? "Unset OLLAMA_HOST (or set it to 127.0.0.1) and turn off \"Expose Ollama to the network\". " +
            "Ollama has no password: whoever reaches it can use your models and read what is sent to them."
          : undefined,
      });

      add({
        id: "ollama-cloud",
        title: "Ollama's cloud",
        verdict: ollama.noCloud ? "ok" : "watch",
        found: ollama.noCloud ? "cloud models are blocked" : "cloud models are not blocked",
        todo: ollama.noCloud
          ? undefined
          : "Set OLLAMA_NO_CLOUD=1 in Ollama's settings. Sylou refuses a model Ollama marks as remote, but " +
            "a name you mistype could otherwise be answered by Ollama's cloud instead of this computer.",
      });

      const models = ollama.models ?? [];
      const noWindow = models.filter((m) => !m.contextLength);
      const spilled = models.filter((m) => m.onGpu === false);
      add({
        id: "models",
        title: "The models Sylou may use",
        verdict: noWindow.length > 0 || spilled.length > 0 ? "watch" : "ok",
        found: models.length === 0
          ? "none listed in config/settings.env"
          : `${models.length} listed${noWindow.length > 0 ? `, ${noWindow.length} without a window of their own` : ""}` +
            `${spilled.length > 0 ? `, ${spilled.length} not fitting the graphics card` : ""}`,
        todo: spilled.length > 0
          ? "A model that does not fit the graphics card runs on the processor instead: minutes, not seconds. " +
            "`sylou models` finds the largest window that still fits."
          : noWindow.length > 0
          ? "A model with no window of its own is refused rather than silently cut short. `sylou models` makes " +
            "a copy with a window."
          : undefined,
      });
    }
  }

  // ---- This install -------------------------------------------------------
  const age = daysSince(host.packageDate, now);
  add({
    id: "release",
    title: "This release",
    verdict: age !== undefined && age > 120 ? "watch" : "ok",
    found: host.packageVersion
      ? `${host.packageVersion}${age === undefined ? "" : `, ${age} days old`}`
      : "unknown",
    todo: age !== undefined && age > 120
      ? "Look for a newer release and run `sylou update`. Updates carry the security fixes of everything " +
        "inside the package."
      : undefined,
  });

  const backupAge = daysSince(host.lastBackup?.at, now);
  add({
    id: "backup",
    title: "The last backup",
    verdict: backupAge === undefined ? "act" : backupAge > 30 ? "watch" : "ok",
    found: backupAge === undefined ? "none made from this install" : `${backupAge} days ago`,
    todo: backupAge === undefined
      ? "Run `sylou backup <folder>`. Everything you write lives in Docker's own storage, which an uninstall " +
        "or a reset takes with it."
      : backupAge > 30
      ? "Run `sylou backup <folder>` again."
      : undefined,
  });

  // ---- The computer -------------------------------------------------------
  if (host.platform === "windows" && host.bitLockerProtection !== undefined) {
    const value = host.bitLockerProtection;
    // A0 had to find this the hard way: without administrator rights the
    // usual commands refuse, and this property tells two very different
    // things apart that "encrypted: yes" would not.
    const protectedOn = value === 1;
    const encryptedUnprotected = value === 7;
    add({
      id: "disk",
      title: "This disk",
      verdict: protectedOn ? "ok" : "watch",
      found: protectedOn
        ? "encrypted, with protection on"
        : encryptedUnprotected
        ? "encrypted, but protection is off - the key sits unprotected on the disk"
        : `Windows reports protection state ${value}`,
      todo: protectedOn
        ? undefined
        : "Turn BitLocker (or device encryption) on in Windows Settings. Until then, whoever holds the " +
          "laptop can read everything written here, backups included.",
    });
  } else if (host.diskEncryption) {
    add({
      id: "disk",
      title: "This disk",
      verdict: host.diskEncryption === "on" ? "ok" : "watch",
      found: host.diskEncryption === "on"
        ? "encrypted"
        : host.diskEncryption === "off"
        ? "not encrypted"
        : "could not be read without administrator rights",
      todo: host.diskEncryption === "on"
        ? undefined
        : "Turn disk encryption on. Until then, whoever holds the computer can read everything written here.",
    });
  }

  // ---- This install's own files -------------------------------------------
  if (host.secrets) {
    const ownerOnly = host.secrets.ownerOnly;
    add({
      id: "secrets",
      title: "This install's secrets",
      verdict: ownerOnly === true ? "ok" : "act",
      found: ownerOnly === true
        ? "readable by your account only"
        : ownerOnly === false
        ? "readable by more than your account"
        : "their permissions could not be read",
      todo: ownerOnly === true
        ? undefined
        : "Run `sylou setup` again: it locks config/ to your account without touching anything else.",
    });

    if (host.secrets.syncedTo) {
      add({
        id: "synced",
        title: "Where this install sits",
        verdict: "act",
        found: `inside ${host.secrets.syncedTo}`,
        todo:
          "Move the folder somewhere that is not synced. Everything here - your writing, the database, this " +
          "install's secrets - is being copied to another computer and kept there.",
      });
    }
  }

  // ---- What doctor can see from the inside ---------------------------------
  if (inside.databaseReachable === false) {
    add({
      id: "database",
      title: "The database",
      verdict: "act",
      found: "not answering",
      todo: "Run `sylou status`, then `sylou logs db`. Nothing can be read or written until it is back.",
    });
  } else if (inside.migrationsApplied !== undefined) {
    add({
      id: "database",
      title: "The database",
      verdict: "ok",
      found: `answering, ${inside.migrationsApplied} migrations applied${inside.schemaVersion ? ` (latest ${inside.schemaVersion})` : ""}`,
    });
  }

  return found;
}

/** The report, as it is printed. */
export function render(found: Check[]): string {
  const width = Math.max(...found.map((check) => check.title.length), 0);
  const lines: string[] = ["", "Sylou doctor", ""];
  for (const check of found) {
    lines.push(`${MARK[check.verdict]} ${check.title.padEnd(width)}  ${check.found}`);
    if (check.todo) {
      for (const part of wrap(check.todo, 76)) lines.push(`${" ".repeat(7 + width + 2)}${part}`);
    }
  }
  const act = found.filter((check) => check.verdict === "act").length;
  const watch = found.filter((check) => check.verdict === "watch").length;
  lines.push("");
  lines.push(
    act === 0 && watch === 0
      ? "Nothing to do."
      : `${act} to do, ${watch} to look at.`,
  );
  lines.push("");
  lines.push("No secret is printed above: this report is safe to paste into an issue.");
  lines.push("");
  return redact(lines.join("\n"));
}

function wrap(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The checks doctor can make itself, from inside Docker. */
async function look(connection?: string): Promise<InsideFacts> {
  const { Client } = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
  const client = new Client(connection ?? connectionString());
  try {
    await client.connect();
    const applied = await client.queryObject<{ count: bigint; latest: string | null }>(
      "select count(*) as count, max(version) as latest from sylou_local.migrations",
    );
    const row = applied.rows[0];
    return {
      databaseReachable: true,
      migrationsApplied: Number(row?.count ?? 0),
      schemaVersion: row?.latest ?? undefined,
    };
  } catch {
    return { databaseReachable: false };
  } finally {
    await client.end().catch(() => {});
  }
}

function connectionString(): string {
  const password = Deno.readTextFileSync("/run/secrets/pg_postgres_password").trim();
  return `postgres://postgres:${encodeURIComponent(password)}@db:5432/postgres`;
}

/** Reads the facts the script gathered, on standard input. */
async function readFacts(): Promise<HostFacts> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) chunks.push(chunk);
  const everything = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    everything.set(chunk, offset);
    offset += chunk.length;
  }
  const text = new TextDecoder().decode(everything).trim();
  if (!text) return {};
  try {
    return JSON.parse(text) as HostFacts;
  } catch {
    return {};
  }
}

export async function doctor(): Promise<number> {
  const host = await readFacts();
  const inside = await look();
  const found = checks(host, inside);
  console.log(render(found));
  return found.some((check) => check.verdict === "act") ? 1 : 0;
}
