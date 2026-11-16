import { defineConfig, loadEnv, type PluginOption } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

/** The Sylou Local build: one image serves every install, so the app reads
 *  its address and key from the page instead (src/lib/runtime-config.ts). */
export const PACKAGE_MODE = "package";

/** The build-time values a package build must not carry. */
const BUILD_TIME_VALUES = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];

/** Loads the file the web container writes at start-up, before the app runs:
 *  a plain script executes ahead of the app's deferred module code. */
function runtimeConfigScript(): PluginOption {
  return {
    name: "sylou-runtime-config-script",
    transformIndexHtml: () => [
      { tag: "script", attrs: { src: "/sylou-runtime.js" }, injectTo: "head-prepend" },
    ],
  };
}

/** A package build carrying one Sylou's address or key would bake it into the
 *  image everyone installs. The .dockerignore allow-list keeps .env files out
 *  of the image build; this also catches a value exported in the environment,
 *  which no ignore file can see. Names only — build logs are public. */
function refuseBuildTimeValues(mode: string): void {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const carried = BUILD_TIME_VALUES.filter((name) => (env[name] ?? "").trim() !== "");
  if (carried.length > 0) {
    throw new Error(
      `vite build --mode ${PACKAGE_MODE} must not carry build-time Supabase values: ` +
        `unset ${carried.join(" and ")}. Sylou Local reads both at run time.`,
    );
  }
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const packaged = mode === PACKAGE_MODE;
  if (packaged) refuseBuildTimeValues(mode);

  return {
    server: {
      // This computer only; `npm run dev -- --host` opens it to the network when needed.
      host: "localhost",
      port: 8080,
      hmr: {
        overlay: false,
      },
    },
    plugins: [react(), tailwindcss(), ...(packaged ? [runtimeConfigScript()] : [])],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
  };
});
