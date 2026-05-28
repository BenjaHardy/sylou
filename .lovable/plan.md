# Per-request CORS allow-list

## Goal

Replace the module-scoped `corsHeaders` constant in every edge function with a per-request helper that parses `ALLOWED_ORIGIN` as a comma-separated allow-list, echoes the incoming `Origin` only when it matches, and otherwise omits `Access-Control-Allow-Origin` entirely. Fail safe on missing config, no wildcard logic in source.

## Files to change

All six edge functions, identical refactor:
- `supabase/functions/chat/index.ts`
- `supabase/functions/analysis/index.ts`
- `supabase/functions/editor-action/index.ts`
- `supabase/functions/context-prompt/index.ts`
- `supabase/functions/extract-text/index.ts`
- `supabase/functions/share-report/index.ts`

Plus documentation:
- `supabase/functions/.env.example` — document `ALLOWED_ORIGIN`.

## Refactor pattern

In each function, remove the top-level `ALLOWED_ORIGIN` + `corsHeaders` constant and replace with:

```ts
// Parse once at module load.
const ALLOWED_ORIGINS_RAW = Deno.env.get("ALLOWED_ORIGIN") ?? "";
const ALLOWED_ORIGINS = ALLOWED_ORIGINS_RAW
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

const BASE_CORS_HEADERS = {
  "Vary": "Origin",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  // Methods header added where the function previously set one; otherwise omit.
};

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  // Non-matching or missing Origin: omit ACAO entirely.
  // Browsers will block; non-browser callers don't need it.
  return { ...BASE_CORS_HEADERS };
}
```

Then within each `Deno.serve` handler:
- Compute `const corsHeaders = corsHeadersFor(req);` at the top of the handler.
- Use that local `corsHeaders` in every response (preflight `OPTIONS`, JSON responses, streaming responses, error responses).
- Any helper that builds responses (e.g. `jsonResponse`) must take `corsHeaders` as a parameter rather than reading a module-level constant. Update call sites accordingly.

No regex matching. No wildcard fallback. No echoing of unmatched origins.

## .env.example addition

Append to `supabase/functions/.env.example`:

```
# ---------------------------------------------------------------------------
# CORS allow-list
# ---------------------------------------------------------------------------
# Comma-separated list of origins (scheme + host, no path, no trailing slash)
# from which browser clients are allowed to call these edge functions. The
# function echoes back the request's Origin header only if it appears in
# this list; otherwise the Access-Control-Allow-Origin header is omitted and
# the browser blocks the response.
#
# Example:
# ALLOWED_ORIGIN=https://sylou.eu,https://app.example.com
#
# If unset, no cross-origin browser requests will be accepted and a warning
# is logged at function startup. Do NOT set this to "*" in production — it
# would allow any site on the internet to call your backend from a user's
# browser.
ALLOWED_ORIGIN=
```

## Out of scope

- No change to client-side code, auth, RLS, or function business logic.
- No change to `supabase/config.toml`.
- No regex / wildcard matching of preview subdomains — operators manage their own allow-list via the secret.
- Print/PDF, pagination, and other ongoing features are untouched.

## Verification

After the edits:
1. Deploy the six functions.
2. From the browser preview, confirm chat + FLOW analysis work (Origin will be in the allow-list once the user adds the preview URL to `ALLOWED_ORIGIN`).
3. `curl` without an `Origin` header: response still succeeds (CORS header simply absent, which is fine for non-browser callers).
4. `curl` with a bogus `Origin`: response body succeeds but lacks `Access-Control-Allow-Origin`, so a real browser would block it.
