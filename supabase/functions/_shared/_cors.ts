// Shared CORS allow-list handling for all edge functions (P4-1, seam #1).
//
// Byte-for-byte the behavior of the eight per-function blocks this
// replaces: ALLOWED_ORIGIN is parsed once at module load (one isolate runs
// one function, so this preserves the parse-once + warn-once semantics),
// and a non-matching or missing Origin omits Access-Control-Allow-Origin
// entirely — browsers block the response; non-browser callers ignore CORS.
// The Allow-Methods string was the only value that differed across the
// copies, so each function passes its own.

const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (ALLOWED_ORIGINS.length === 0) {
  console.warn(
    "[cors] ALLOWED_ORIGIN is not set. No cross-origin browser requests " +
    "will be accepted. Set ALLOWED_ORIGIN to a comma-separated list of " +
    "origins this instance is served from (e.g. https://example.com).",
  );
}

const ALLOW_HEADERS =
  "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version";

/** Build a function's `corsHeadersFor(req)` bound to its Allow-Methods. */
export function makeCorsHeadersFor(allowMethods: string) {
  const base: Record<string, string> = {
    "Vary": "Origin",
    "Access-Control-Allow-Methods": allowMethods,
    "Access-Control-Allow-Headers": ALLOW_HEADERS,
  };
  return function corsHeadersFor(req: Request): Record<string, string> {
    const origin = req.headers.get("Origin");
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      return { ...base, "Access-Control-Allow-Origin": origin };
    }
    // Non-matching or missing Origin: omit Access-Control-Allow-Origin
    // entirely. Browsers will block the response; non-browser callers
    // ignore CORS.
    return { ...base };
  };
}
