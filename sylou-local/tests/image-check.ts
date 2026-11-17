// T62: what a built image must not carry, and whom it must run as.
//
// The repository's .dockerignore is an allow-list, so a build cannot see a
// settings file, a secret or a tool's sign-in in the first place; this looks
// inside each image built in CI to make sure none arrived anyway. It lists
// every path in the image, reads the text of the folders that hold our own
// files, and checks that the image runs as a user of its own.
//
//   deno run --allow-run=docker,sh --allow-read --allow-write tests/image-check.ts \
//     <image> <folder of ours> [<folder of ours>...]

/** Paths no image of ours may hold, wherever they sit. */
export const FORBIDDEN_PATHS: [RegExp, string][] = [
  [/(^|\/)\.env(\.[^/]*)?$/, "an environment file"],
  [/(^|\/)settings\.env$/, "a Sylou settings file"],
  [/(^|\/)config\/secrets(\/|$)/, "an install's secrets"],
  [/(^|\/)\.git(\/|$)/, "a git checkout"],
  [/(^|\/)\.(ssh|aws|azure|kube|gnupg)(\/|$)/, "a home folder's credentials"],
  [/(^|\/)\.docker\/config\.json$/, "Docker's sign-ins"],
  [/(^|\/)\.(npmrc|netrc|git-credentials|pgpass)$/, "a tool's credentials"],
  [/(^|\/)supabase\/\.(temp|branches)(\/|$)/, "the Supabase CLI's own state"],
  [/(^|\/)\.(claude|vercel)(\/|$)/, "a tool's local state"],
  [/(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, "a private key"],
];

/** Text no file of ours may hold. */
export const SECRET_SHAPES: [RegExp, string][] = [
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/, "a signed token"],
  [/sb_secret_[A-Za-z0-9_-]{10,}/, "a Supabase secret key"],
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "an Anthropic key"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "a private key"],
  [/gh[pousr]_[A-Za-z0-9]{36}/, "a GitHub token"],
  [/AKIA[0-9A-Z]{16}/, "an AWS key"],
];

/** What is wrong with an image, from its paths and its user. */
export function problems(paths: string[], user: string): string[] {
  const found: string[] = [];
  const name = user.split(":")[0];
  if (name === "" || name === "root" || name === "0") found.push(`runs as root (USER "${user}")`);
  for (const path of paths) {
    const clean = path.replace(/^\.?\//, "").replace(/\/$/, "");
    for (const [pattern, what] of FORBIDDEN_PATHS) {
      if (pattern.test(clean)) found.push(`${what}: /${clean}`);
    }
  }
  return found;
}

/** What a file's text looks like it holds. */
export function secretsIn(text: string): string[] {
  return SECRET_SHAPES.filter(([pattern]) => pattern.test(text)).map(([, what]) => what);
}

async function run(command: string, args: string[]): Promise<string> {
  const output = await new Deno.Command(command, { args, stdout: "piped", stderr: "piped" }).output();
  if (!output.success) throw new Error(`${command} ${args.join(" ")}: ${new TextDecoder().decode(output.stderr)}`);
  return new TextDecoder().decode(output.stdout);
}

/** The files at a path, itself included when it is one. Links are not
 *  followed: what they point at is checked where it lives. */
async function* files(path: string): AsyncGenerator<string> {
  const info = await Deno.lstat(path);
  if (info.isFile) {
    yield path;
    return;
  }
  if (!info.isDirectory) return;
  for await (const entry of Deno.readDir(path)) yield* files(`${path}/${entry.name}`);
}

/** A file this size or larger is not read: our own files are far smaller. */
const LARGEST = 64 * 1024 * 1024;

export async function checkImage(image: string, ours: string[]): Promise<string[]> {
  const user = (await run("docker", ["image", "inspect", image, "--format", "{{.Config.User}}"])).trim();
  const container = (await run("docker", ["create", image])).trim();
  const scratch = await Deno.makeTempDir({ prefix: "sylou-image-check-" });
  try {
    const listing = await run("sh", ["-c", `docker export "$1" | tar -t`, "sh", container]);
    const found = problems(listing.split("\n").filter(Boolean), user);
    for (const folder of ours) {
      const into = `${scratch}/${folder.replaceAll("/", "_")}`;
      await run("docker", ["cp", `${container}:${folder}`, into]);
      for await (const path of files(into)) {
        if ((await Deno.stat(path)).size >= LARGEST) continue;
        const text = new TextDecoder("latin1").decode(await Deno.readFile(path));
        for (const what of secretsIn(text)) found.push(`${what} in ${folder}${path.slice(into.length)}`);
      }
    }
    return found;
  } finally {
    await run("docker", ["rm", container]).catch(() => "");
    await Deno.remove(scratch, { recursive: true }).catch(() => {});
  }
}

if (import.meta.main) {
  const [image, ...ours] = Deno.args;
  if (!image || ours.length === 0) {
    console.error("usage: image-check.ts <image> <folder of ours>...");
    Deno.exit(2);
  }
  const found = await checkImage(image, ours);
  const title = `T62 ${image}`.replaceAll("%", "%25").replaceAll(":", "%3A").replaceAll(",", "%2C");
  for (const problem of found) {
    console.log(Deno.env.get("GITHUB_ACTIONS") === "true" ? `::error title=${title}::${problem}` : `${image}: ${problem}`);
  }
  console.log(`${image}: ${found.length === 0 ? "nothing it should not carry, and not root" : `${found.length} problem(s)`}`);
  Deno.exit(found.length === 0 ? 0 : 1);
}
