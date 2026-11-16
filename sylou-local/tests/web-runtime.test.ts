// The web image's start-up script (web/docker-entrypoint.d/40-sylou-runtime.sh)
// writes the password floor into a script the pages load, as a number. These
// are the values it must refuse rather than write.
//
// It runs where a POSIX shell is (Linux, macOS, Git for Windows), and only up
// to its refusal: a value it accepts is written to /tmp, which the image's
// own start covers.
//
// Run with: deno task test  (from sylou-local/)
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";

const SCRIPT = fromFileUrl(new URL("../web/docker-entrypoint.d/40-sylou-runtime.sh", import.meta.url));

async function haveSh(): Promise<boolean> {
  try {
    return (await new Deno.Command("sh", { args: ["-c", "exit 0"], stdout: "null", stderr: "null" }).output()).success;
  } catch {
    return false;
  }
}

Deno.test({
  name: "the password floor is refused unless it is a plain whole number from 1 up",
  ignore: !(await haveSh()),
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "sylou-web-runtime-" });
    try {
      const key = join(dir, "publishable_key");
      await Deno.writeTextFile(key, "sb_publishable_abc123DEF456");
      // 015 would reach the browser as 13; 0 would leave the page to its own
      // fallback of 8. (Left empty, it means the default, 15.)
      for (const value of ["015", "0", "fifteen"]) {
        const run = await new Deno.Command("sh", {
          args: [SCRIPT],
          env: { SYLOU_PUBLISHABLE_KEY_FILE: key, SYLOU_MIN_PASSWORD_LENGTH: value },
          stdout: "piped",
          stderr: "piped",
        }).output();
        assertEquals(run.code, 1, `"${value}" was accepted`);
        assertStringIncludes(new TextDecoder().decode(run.stderr), "SYLOU_MIN_PASSWORD_LENGTH", `"${value}"`);
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
