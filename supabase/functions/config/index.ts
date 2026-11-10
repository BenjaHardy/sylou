import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";
import type { ConfigDeps } from "../_shared/_handler.ts";
import { fetchLocalModelInfo, listedOllamaModels, NOT_ANSWERING_ERROR, ollamaName } from "../_shared/_ollama.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, OPTIONS");

const defaultDeps: ConfigDeps = { env: Deno.env, createClient };

/**
 * GET /functions/v1/config
 *
 * Returns instance-level capability flags for the frontend so it can
 * honestly reflect what's actually configured on this Sylou deployment.
 * No auth required — response contains only feature flags, no user data.
 * A signed-in caller of an instance that lists local models (OLLAMA_MODELS)
 * also gets those models, as their server reports them: only then does the
 * function ask the model server, so a caller without a sign-in never makes
 * it reach that server.
 */
export const handler = async (req: Request, deps = defaultDeps): Promise<Response> => {
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

  const body: Record<string, unknown> = {
    web_search_enabled: !!deps.env.get("BRAVE_SEARCH_API_KEY"),
  };

  const localModels = listedOllamaModels(deps.env);
  if (localModels.length > 0 && await isSignedIn(req, deps)) {
    body.local_models = await Promise.all(localModels.map((model) => describeLocalModel(model, deps)));
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

/** Whether the request carries a signed-in user's token (share-report's check). */
async function isSignedIn(req: Request, deps: ConfigDeps): Promise<boolean> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;
  try {
    const supabase = deps.createClient(deps.env.get("SUPABASE_URL")!, deps.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await supabase.auth.getClaims(authHeader.slice("Bearer ".length));
    const claims = data?.claims;
    return !error && typeof claims?.sub === "string" && claims.role === "authenticated";
  } catch (err) {
    console.error("[config] sign-in check failed:", err);
    return false;
  }
}

/** One listed local model: its window and tools, or what keeps it from running. */
async function describeLocalModel(model: string, deps: ConfigDeps): Promise<Record<string, unknown>> {
  const name = ollamaName(model);
  const info = await (deps.localModelInfo ?? fetchLocalModelInfo)(model, deps.env);
  if (!("error" in info)) return { id: model, name, context_tokens: info.contextTokens, tools: info.tools };
  if (info.error === NOT_ANSWERING_ERROR) return { id: model, name, not_answering: true };
  return { id: model, name, problem: info.error };
}

Deno.serve((req) => handler(req));
