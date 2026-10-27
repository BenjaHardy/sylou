// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";
import type { EnvDeps } from "../_shared/_handler.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, OPTIONS");

const defaultDeps: EnvDeps = { env: Deno.env };

/**
 * GET /functions/v1/config
 *
 * Returns instance-level capability flags for the frontend so it can
 * honestly reflect what's actually configured on this Sylou deployment.
 * No auth required — response contains only feature flags, no user data.
 */
export const handler = (req: Request, deps = defaultDeps): Response => {
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
    web_search_enabled: !!deps.env.get("BRAVE_SEARCH_API_KEY"),
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

Deno.serve((req) => handler(req));
