import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";

import { makeCorsHeadersFor } from "../_shared/_cors.ts";
import type { ClientDeps } from "../_shared/_handler.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, POST, OPTIONS");

function generateCertificateId(): string {
  // 32 characters (no I, O, 0, 1): a power of two, so a 5-bit mask picks each
  // one with exactly equal probability.
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const random = crypto.getRandomValues(new Uint8Array(8));
  let result = "FLOW-";
  for (const value of random) {
    result += chars[value & 31];
  }
  return result;
}

const defaultDeps: ClientDeps = { env: Deno.env, createClient };

export const handler = async (req: Request, deps = defaultDeps): Promise<Response> => {
  const corsHeaders = corsHeadersFor(req);
  const jsonResponse = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = deps.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = deps.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = deps.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = deps.createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    const body = await req.json();
    const { report_id, action } = body;

    if (!report_id || typeof report_id !== "string") {
      return jsonResponse({ error: "report_id is required" }, 400);
    }

    const adminSupabase = deps.createClient(supabaseUrl, serviceRoleKey);

    // Verify ownership: report -> project -> user
    const { data: report, error: reportErr } = await adminSupabase
      .from("flow_reports")
      .select("id, project_id, share_token, certificate_id, share_enabled")
      .eq("id", report_id)
      .single();

    if (reportErr || !report) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    const { data: project, error: projectErr } = await adminSupabase
      .from("projects")
      .select("id, user_id, name")
      .eq("id", report.project_id)
      .single();

    if (projectErr || !project || project.user_id !== userId) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    // Action: "toggle" — update share_enabled and/or share_include_feedback
    if (action === "toggle") {
      const { share_enabled, share_include_feedback, share_include_replay, share_include_report, share_include_profile } = body;

      const updateData: Record<string, unknown> = {};

      if (typeof share_enabled === "boolean") {
        updateData.share_enabled = share_enabled;
        if (share_enabled) {
          updateData.project_name = project.name;
        }
      }

      if (typeof share_include_feedback === "boolean") {
        updateData.share_include_feedback = share_include_feedback;
      }

      if (typeof share_include_replay === "boolean") {
        updateData.share_include_replay = share_include_replay;
      }

      if (typeof share_include_report === "boolean") {
        updateData.share_include_report = share_include_report;
      }

      if (typeof share_include_profile === "boolean") {
        updateData.share_include_profile = share_include_profile;
      }

      if (Object.keys(updateData).length === 0) {
        return jsonResponse({ error: "No valid fields to update" }, 400);
      }

      const { error: updateErr } = await adminSupabase
        .from("flow_reports")
        .update(updateData)
        .eq("id", report_id);

      if (updateErr) {
        console.error("Error toggling sharing:", updateErr);
        return jsonResponse({ error: "Failed to update sharing status" }, 500);
      }

      return jsonResponse({ ...updateData });
    }

    // Default action: generate share token and certificate
    const shareToken = crypto.randomUUID();

    let certificateId = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = generateCertificateId();
      const { data: existing } = await adminSupabase
        .from("flow_reports")
        .select("id")
        .eq("certificate_id", candidate)
        .maybeSingle();

      if (!existing) {
        certificateId = candidate;
        break;
      }
    }

    if (!certificateId) {
      return jsonResponse({ error: "Failed to generate unique certificate ID" }, 500);
    }

    const { error: updateErr } = await adminSupabase
      .from("flow_reports")
      .update({
        share_token: shareToken,
        certificate_id: certificateId,
        share_enabled: true,
        share_visibility: "public",
        project_name: project.name,
      })
      .eq("id", report_id);

    if (updateErr) {
      console.error("Error enabling sharing:", updateErr);
      return jsonResponse({ error: "Failed to enable sharing" }, 500);
    }

    return jsonResponse({
      share_token: shareToken,
      certificate_id: certificateId,
      project_name: project.name,
    });
  } catch (err) {
    console.error("share-report error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
};

Deno.serve((req) => handler(req));
