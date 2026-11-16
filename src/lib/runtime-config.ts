// Where this Sylou's Supabase services answer, and the publishable key its
// pages are served with. Two shapes:
//
// - Hosted Sylou and `npm run dev`: both values are baked into the bundle at
//   build time from VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
// - Sylou Local: the package's build (`vite build --mode package`) carries
//   neither, because one image serves every install. The services answer on
//   the page's own origin — the front door forwards /auth/v1/, /rest/v1/,
//   /storage/v1/object/ and /functions/v1/ to them — and the key arrives in
//   window.__SYLOU__, from /sylou-runtime.js, which the web container writes
//   at start-up from the key file it was given (sylou-local/web).
//
// The readers are functions rather than top-level constants: a module this
// widely imported must not throw while it is being imported.

/** What /sylou-runtime.js puts on the page. Typed as unknown and checked
 *  before use: the file is generated, but a malformed one must fail with the
 *  message below rather than with a type error deep in the app. */
interface RuntimeScriptValues {
  publishableKey?: unknown;
  minPasswordLength?: unknown;
}

declare global {
  interface Window {
    __SYLOU__?: RuntimeScriptValues;
  }
}

/** Password floor on hosted Sylou. Sylou Local's sign-in service refuses
 *  shorter ones and the package serves its own number, so the set-password
 *  page cannot contradict the service that checks it. */
export const DEFAULT_MIN_PASSWORD_LENGTH = 8;

export const MISSING_RUNTIME_CONFIG_MESSAGE =
  "Sylou does not know where its services are. A build needs VITE_SUPABASE_URL and " +
  "VITE_SUPABASE_PUBLISHABLE_KEY; a Sylou Local install is served /sylou-runtime.js by its " +
  "own web container.";

export interface RuntimeConfig {
  /** Base URL of this Sylou's Supabase services, without a trailing slash. */
  url: string;
  /** The publishable ("anon") key every page of this Sylou is served. */
  key: string;
  /** Floor for a password chosen on the set-password page. */
  minPasswordLength: number;
  /** True when the values came from the page: a Sylou Local install, which
   *  has no email of its own and its own password floor. */
  packaged: boolean;
}

/** The two build-time values, as read from import.meta.env. */
export interface BuildValues {
  url?: string;
  key?: string;
}

/** What the page itself offers: its origin, and the runtime script's values
 *  when the install served one. */
export interface PageValues {
  origin: string;
  runtime?: RuntimeScriptValues;
}

const withoutTrailingSlash = (value: string) => value.trim().replace(/\/+$/, "");

/** Build values win whenever both are set, so hosted Sylou never consults
 *  the page. A half-configured build falls through to the error rather than
 *  quietly calling its own origin. */
export function resolveRuntimeConfig(build: BuildValues, page: PageValues): RuntimeConfig {
  const buildUrl = withoutTrailingSlash(build.url ?? "");
  const buildKey = (build.key ?? "").trim();
  if (buildUrl && buildKey) {
    return {
      url: buildUrl,
      key: buildKey,
      minPasswordLength: DEFAULT_MIN_PASSWORD_LENGTH,
      packaged: false,
    };
  }

  const origin = withoutTrailingSlash(page.origin ?? "");
  const runtimeKey = typeof page.runtime?.publishableKey === "string"
    ? page.runtime.publishableKey.trim()
    : "";
  if (origin && runtimeKey) {
    const min = page.runtime?.minPasswordLength;
    return {
      url: origin,
      key: runtimeKey,
      minPasswordLength: typeof min === "number" && Number.isInteger(min) && min > 0
        ? min
        : DEFAULT_MIN_PASSWORD_LENGTH,
      packaged: true,
    };
  }

  throw new Error(MISSING_RUNTIME_CONFIG_MESSAGE);
}

function runtimeConfig(): RuntimeConfig {
  return resolveRuntimeConfig(
    {
      url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
      key: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined,
    },
    typeof window === "undefined"
      ? { origin: "" }
      : { origin: window.location.origin, runtime: window.__SYLOU__ },
  );
}

/** Base URL of this Sylou's Supabase services, without a trailing slash. */
export function supabaseUrl(): string {
  return runtimeConfig().url;
}

/** The publishable ("anon") key this Sylou's pages are served. */
export function publishableKey(): string {
  return runtimeConfig().key;
}

/** Floor for a password chosen on the set-password page. */
export function minPasswordLength(): number {
  return runtimeConfig().minPasswordLength;
}

/** Whether this is a Sylou Local install: it cannot send email, so the pages
 *  that would offer an email flow explain the install's own command instead. */
export function isPackaged(): boolean {
  return runtimeConfig().packaged;
}
