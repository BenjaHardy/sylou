// Where the app gets its address and key: baked into the bundle for hosted
// Sylou, from the page for a Sylou Local install (one image, every install),
// and a clear error rather than a guess when neither carries them.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MIN_PASSWORD_LENGTH,
  MISSING_RUNTIME_CONFIG_MESSAGE,
  resolveRuntimeConfig,
} from "@/lib/runtime-config";

const BUILD = { url: "https://project.supabase.co", key: "build-key" };
const PAGE = { origin: "http://localhost:8080" };
const script = (values: Record<string, unknown>) => ({ ...PAGE, runtime: values });

describe("resolveRuntimeConfig", () => {
  it("takes the build-time values when both are set, and never looks at the page", () => {
    expect(resolveRuntimeConfig(BUILD, script({ publishableKey: "page-key", minPasswordLength: 15 })))
      .toEqual({
        url: "https://project.supabase.co",
        key: "build-key",
        minPasswordLength: DEFAULT_MIN_PASSWORD_LENGTH,
        packaged: false,
      });
  });

  it("drops trailing slashes and surrounding spaces from either source", () => {
    expect(resolveRuntimeConfig({ url: " https://project.supabase.co/ ", key: " build-key " }, PAGE).url)
      .toBe("https://project.supabase.co");
    expect(resolveRuntimeConfig({}, { origin: "http://localhost:8080/", runtime: { publishableKey: " page-key " } }))
      .toMatchObject({ url: "http://localhost:8080", key: "page-key" });
  });

  it("without build values, serves itself from the page's own origin with the script's key", () => {
    expect(resolveRuntimeConfig({}, script({ publishableKey: "page-key" }))).toEqual({
      url: "http://localhost:8080",
      key: "page-key",
      minPasswordLength: DEFAULT_MIN_PASSWORD_LENGTH,
      packaged: true,
    });
  });

  it("takes the install's own password floor", () => {
    expect(resolveRuntimeConfig({}, script({ publishableKey: "page-key", minPasswordLength: 15 })))
      .toMatchObject({ minPasswordLength: 15, packaged: true });
  });

  it("falls back to the default floor when the script's number is missing or not a whole positive one", () => {
    for (const minPasswordLength of [undefined, 0, -15, 12.5, "15", null]) {
      expect(resolveRuntimeConfig({}, script({ publishableKey: "page-key", minPasswordLength })))
        .toMatchObject({ minPasswordLength: DEFAULT_MIN_PASSWORD_LENGTH });
    }
  });

  it("ignores a script whose key is not a usable string", () => {
    for (const publishableKey of [undefined, "", "   ", 42, null, {}]) {
      expect(() => resolveRuntimeConfig({}, script({ publishableKey })))
        .toThrow(MISSING_RUNTIME_CONFIG_MESSAGE);
    }
  });

  it("refuses a half-configured build instead of quietly calling the page's own origin", () => {
    expect(() => resolveRuntimeConfig({ url: BUILD.url }, PAGE)).toThrow(MISSING_RUNTIME_CONFIG_MESSAGE);
    expect(() => resolveRuntimeConfig({ key: BUILD.key }, PAGE)).toThrow(MISSING_RUNTIME_CONFIG_MESSAGE);
  });

  it("names both sources when nothing carries the values", () => {
    expect(() => resolveRuntimeConfig({}, { origin: "" })).toThrow(MISSING_RUNTIME_CONFIG_MESSAGE);
    expect(MISSING_RUNTIME_CONFIG_MESSAGE).toContain("VITE_SUPABASE_URL");
    expect(MISSING_RUNTIME_CONFIG_MESSAGE).toContain("/sylou-runtime.js");
  });
});
