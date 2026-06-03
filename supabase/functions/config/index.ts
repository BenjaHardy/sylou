// --- CORS allow-list (parsed once at module load) ---
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

const BASE_CORS_HEADERS: Record<string, string> = {
  "Vary": "Origin",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    return { ...BASE_CORS_HEADERS, "Access-Control-Allow-Origin": origin };
  }
  // Non-matching or missing Origin: omit Access-Control-Allow-Origin entirely.
  // Browsers will block the response; non-browser callers ignore CORS.
  return { ...BASE_CORS_HEADERS };
}

/**
 * GET /functions/v1/config
 *
 * Returns instance-level capability flags for the frontend so it can
 * honestly reflect what's actually configured on this Sylou deployment.
 * No auth required — response contains only feature flags, no user data.
 */
Deno.serve((req) => {
  const corsHeaders = corsHeadersFor(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = {
    web_search_enabled: !!Deno.env.get("BRAVE_SEARCH_API_KEY"),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
