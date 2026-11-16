// `vite build --mode package` is the Sylou Local build: the app reads its
// address and key at run time (src/lib/runtime-config.ts), so index.html has
// to load /sylou-runtime.js, and the build must carry neither value. Every
// other build must be untouched — hosted Sylou would otherwise ask for a file
// that does not exist there.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigEnv, Plugin, UserConfig } from "vite";
import factory, { PACKAGE_MODE } from "../../../vite.config";

type Factory = (env: ConfigEnv) => UserConfig;

const build = (mode: string) => (factory as unknown as Factory)({ command: "build", mode });

function pluginNames(config: UserConfig): string[] {
  return (config.plugins ?? [])
    .flat(Infinity as 1)
    .map((plugin) => (plugin as Plugin | null)?.name)
    .filter((name): name is string => typeof name === "string");
}

function runtimeScriptPlugin(config: UserConfig): Plugin | undefined {
  return (config.plugins ?? [])
    .flat(Infinity as 1)
    .find((plugin) => (plugin as Plugin | null)?.name === "sylou-runtime-config-script") as Plugin | undefined;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the package build", () => {
  it("adds the runtime-config script ahead of the app", () => {
    const plugin = runtimeScriptPlugin(build(PACKAGE_MODE));
    expect(plugin).toBeDefined();
    const transform = plugin?.transformIndexHtml;
    expect(typeof transform).toBe("function");
    expect((transform as () => unknown)()).toEqual([
      { tag: "script", attrs: { src: "/sylou-runtime.js" }, injectTo: "head-prepend" },
    ]);
  });

  it("leaves every other build alone", () => {
    for (const mode of ["production", "development"]) {
      expect(pluginNames(build(mode))).not.toContain("sylou-runtime-config-script");
    }
  });

  it("refuses to build a package that carries one Sylou's address or key, naming the variable only", () => {
    for (const name of ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
      vi.stubEnv(name, "a-value-that-must-not-be-printed");
      let message = "";
      expect(() => build(PACKAGE_MODE)).toThrow(/must not carry build-time Supabase values/);
      try {
        build(PACKAGE_MODE);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toContain(name);
      expect(message).not.toContain("a-value-that-must-not-be-printed");
      vi.unstubAllEnvs();
    }
  });

  it("builds a package when neither value is set", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "");
    expect(pluginNames(build(PACKAGE_MODE))).toContain("sylou-runtime-config-script");
  });
});
