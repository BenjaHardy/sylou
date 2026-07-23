// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, OPTIONS");

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
