// What a failed package run leaves to read: every container's log, with this
// install's secrets taken out first, since what CI keeps can be downloaded by
// others. A container that stopped badly, or is not healthy, also gets the
// end of its log as an annotation on the run.
//
//   deno run --allow-run=docker --allow-read --allow-write --allow-env \
//     tests/package-logs.ts <out folder> [<install folder>]
//   deno run ... tests/package-logs.ts --tail <file> <title> [<install folder>]

import { join } from "https://deno.land/std@0.224.0/path/mod.ts";

const ci = Deno.env.get("GITHUB_ACTIONS") === "true";

function secretsOf(installDir: string): string[] {
  const folder = join(installDir, "config", "secrets");
  const values: string[] = [];
  try {
    for (const entry of Deno.readDirSync(folder)) {
      if (!entry.isFile) continue;
      const value = Deno.readTextFileSync(join(folder, entry.name)).trim();
      if (value.length >= 8) values.push(value);
    }
  } catch {
    // No secrets folder: nothing to take out.
  }
  return values;
}

export function redact(text: string, secrets: string[]): string {
  let out = text.replace(/(token=)[^&\s"]+/g, "$1[hidden]");
  for (const secret of secrets) out = out.replaceAll(secret, "[secret]");
  return out;
}

function annotate(title: string, text: string) {
  const data = text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
  const property = title.replaceAll("%", "%25").replaceAll(":", "%3A").replaceAll(",", "%2C");
  console.log(ci ? `::error title=${property}::${data}` : `${title}:\n${text}`);
}

function tail(text: string, lines: number): string {
  return text.trimEnd().split("\n").slice(-lines).join("\n").slice(-3500);
}

async function run(command: string, args: string[]) {
  const output = await new Deno.Command(command, { args, stdout: "piped", stderr: "piped" }).output();
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
  return { ok: output.success, out: decode(output.stdout), err: decode(output.stderr) };
}

/** The part of `docker inspect` read here. */
interface Inspected {
  Config: { Image: string; Labels: Record<string, string> };
  State: { Status: string; Running: boolean; Restarting: boolean; ExitCode: number; Health?: { Status: string } };
}

async function collect(outDir: string, installDir: string) {
  const secrets = secretsOf(installDir);
  await Deno.mkdir(outDir, { recursive: true });
  const project = Deno.env.get("COMPOSE_PROJECT_NAME") || "sylou";
  const ids = (await run("docker", ["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`])).out
    .split(/\s+/).filter(Boolean);
  const summary: string[] = [];
  for (const id of ids) {
    const [detail] = JSON.parse((await run("docker", ["inspect", id])).out) as Inspected[];
    const service = detail.Config.Labels["com.docker.compose.service"] ?? "unknown";
    const state = detail.State;
    const health = state.Health?.Status ?? "-";
    summary.push(`${service.padEnd(10)} ${state.Status.padEnd(8)} exit ${state.ExitCode} health ${health} ${detail.Config.Image}`);
    const logs = await run("docker", ["logs", "--timestamps", id]);
    const text = redact(`${logs.out}${logs.err}`, secrets);
    await Deno.writeTextFile(join(outDir, `${service}-${id.slice(0, 12)}.log`), text);
    const stoppedBadly = !state.Running && state.ExitCode !== 0;
    if (stoppedBadly || health === "unhealthy" || state.Restarting) {
      annotate(`${service}: ${state.Status}, exit ${state.ExitCode}, health ${health}`, tail(text, 30));
    }
  }
  await Deno.writeTextFile(join(outDir, "containers.txt"), `${summary.join("\n")}\n`);
  console.log(`package-logs: ${ids.length} container(s) written to ${outDir}`);
  if (ids.length > 0) annotate("Containers when the run stopped", summary.join("\n"));
}

if (import.meta.main) {
  if (Deno.args[0] === "--tail") {
    const [, file, title, installDir = "."] = Deno.args;
    const text = await Deno.readTextFile(file).catch(() => "(no output was kept)");
    annotate(title, tail(redact(text, secretsOf(installDir)), 40));
  } else {
    const [outDir, installDir = "."] = Deno.args;
    if (!outDir) {
      console.error("usage: package-logs.ts <out folder> [<install folder>]");
      Deno.exit(2);
    }
    await collect(outDir, installDir);
  }
}
