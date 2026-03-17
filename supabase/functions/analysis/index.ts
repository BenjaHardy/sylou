import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const FLOW_PROMPT_TEMPLATE = `You are an academic integrity analyst performing a FLOW analysis. FLOW stands for Find, Lead, Organize, Write — the four dimensions of original academic work.

Analyze the student's writing process holistically by examining:
1. The provenance-annotated writing (showing what was typed [t], copy-pasted from chat [cc], copy-pasted from external [ce], or AI-generated [ai])
2. The full chat history between the student and the AI assistant
3. AI editor action statistics

For each FLOW dimension, provide:
- reasoning: Your analytical reasoning about this dimension
- evidence: 2-4 specific pieces of evidence from the writing/chat history
- score: A score from 0-5 (or null if insufficient evidence). 0 = no original contribution, 5 = fully original and independent work
- narrative: A brief narrative summary suitable for the student

Dimensions:
- FIND: Did the student independently identify and gather relevant sources, ideas, and information? Or did they rely entirely on AI to find content?
- LEAD: Did the student drive the direction of the work? Did they make decisions about structure, argument, and focus? Or did the AI lead?
- ORGANIZE: Did the student structure and arrange their ideas coherently? Did they create logical flow and connections?
- WRITE: Did the student produce original prose? What proportion was typed vs AI-generated or copy-pasted?

Also provide an overall summary paragraph.

IMPORTANT: Use the submit_flow_analysis tool to return your analysis in structured format.`;

const SUBMIT_FLOW_TOOL = {
  name: "submit_flow_analysis",
  description: "Submit the structured FLOW analysis results",
  input_schema: {
    type: "object" as const,
    required: ["summary", "find", "lead", "organize", "write"],
    properties: {
      summary: { type: "string" as const, description: "Overall summary paragraph" },
      find: {
        type: "object" as const,
        required: ["reasoning", "evidence", "score", "narrative"],
        properties: {
          reasoning: { type: "string" as const },
          evidence: { type: "array" as const, items: { type: "string" as const } },
          score: { type: ["number", "null"] as const },
          narrative: { type: "string" as const },
        },
      },
      lead: {
        type: "object" as const,
        required: ["reasoning", "evidence", "score", "narrative"],
        properties: {
          reasoning: { type: "string" as const },
          evidence: { type: "array" as const, items: { type: "string" as const } },
          score: { type: ["number", "null"] as const },
          narrative: { type: "string" as const },
        },
      },
      organize: {
        type: "object" as const,
        required: ["reasoning", "evidence", "score", "narrative"],
        properties: {
          reasoning: { type: "string" as const },
          evidence: { type: "array" as const, items: { type: "string" as const } },
          score: { type: ["number", "null"] as const },
          narrative: { type: "string" as const },
        },
      },
      write: {
        type: "object" as const,
        required: ["reasoning", "evidence", "score", "narrative"],
        properties: {
          reasoning: { type: "string" as const },
          evidence: { type: "array" as const, items: { type: "string" as const } },
          score: { type: ["number", "null"] as const },
          narrative: { type: "string" as const },
        },
      },
    },
  },
};

function buildProvenanceAnnotatedWriting(
  content: string,
  segmentMap: Array<{ start: number; end: number; type: string }>
): string {
  if (!segmentMap || segmentMap.length === 0) {
    return `[t]${content}`;
  }

  // Sort segments by start position
  const sorted = [...segmentMap].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;

  for (const seg of sorted) {
    // Fill gap before this segment with [t]
    if (seg.start > cursor) {
      result += `[t]${content.slice(cursor, seg.start)}`;
    }
    const tag = seg.type === "typed" ? "[t]"
      : seg.type === "copy_chat" ? "[cc]"
      : seg.type === "copy_external" ? "[ce]"
      : seg.type === "ai" ? "[ai]"
      : `[${seg.type}]`;
    result += `${tag}${content.slice(seg.start, seg.end)}`;
    cursor = seg.end;
  }

  // Remaining content after last segment
  if (cursor < content.length) {
    result += `[t]${content.slice(cursor)}`;
  }

  return result;
}

function buildChatHistoryString(
  messages: Array<{
    created_at: string;
    role: string;
    content: string;
    source_type: string | null;
    flow_flag: string | null;
    thread_name: string;
  }>
): string {
  return messages
    .map((m) => {
      const dt = new Date(m.created_at);
      const ts = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
      let line = `[${ts} — Thread: ${m.thread_name}] ${m.role}: ${m.content}`;
      if (m.source_type && m.source_type !== "chat") {
        line += ` [${m.source_type}]`;
      }
      if (m.flow_flag === "not_assessed") {
        line = `[NOT ASSESSED] ${line}`;
      }
      return line;
    })
    .join("\n\n");
}

function buildEditorStatsString(
  actions: Array<{ action_type: string; outcome: string; char_count_original: number | null; char_count_result: number | null }>
): string {
  if (!actions || actions.length === 0) {
    return "No AI editor actions recorded.";
  }

  const byType: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  let totalOrigChars = 0;
  let acceptedResultChars = 0;

  for (const a of actions) {
    byType[a.action_type] = (byType[a.action_type] || 0) + 1;
    byOutcome[a.outcome] = (byOutcome[a.outcome] || 0) + 1;
    if (a.outcome === "accepted" && a.char_count_result) {
      acceptedResultChars += a.char_count_result;
    }
    if (a.char_count_original) {
      totalOrigChars += a.char_count_original;
    }
  }

  const lines = [
    `Total AI editor actions: ${actions.length}`,
    `By type: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `By outcome: ${Object.entries(byOutcome).map(([k, v]) => `${k}=${v}`).join(", ")}`,
  ];

  if (acceptedResultChars > 0 && totalOrigChars > 0) {
    const pct = Math.round((acceptedResultChars / totalOrigChars) * 100);
    lines.push(`Estimated % of writing from accepted AI suggestions: ~${pct}%`);
  }

  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // --- Auth ---
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // --- Parse body ---
    const body = await req.json();
    const projectId: string = body.project_id;
    if (!projectId) {
      return jsonResponse({ error: "project_id is required" }, 400);
    }

    // --- Verify project ownership (RLS) + get settings ---
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id, language, tutor_mode")
      .eq("id", projectId)
      .single();

    if (projectErr || !project) {
      return jsonResponse({ error: "Project not found or not owned by user" }, 404);
    }

    // --- Token budget check ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("tokens_used_this_period, monthly_token_budget")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    const budgetRemaining = profile.monthly_token_budget - profile.tokens_used_this_period;
    if (budgetRemaining < 25000) {
      return jsonResponse({ error: "Insufficient token budget for FLOW analysis (requires ~25k tokens)" }, 403);
    }

    // --- Fetch all project data in parallel ---
    const [writingRes, threadsRes, provenanceRes, editorActionsRes, statsRes] = await Promise.all([
      supabase
        .from("writing_content")
        .select("content")
        .eq("project_id", projectId)
        .single(),
      supabase
        .from("chat_threads")
        .select("id, name")
        .eq("project_id", projectId),
      supabase
        .from("provenance_events")
        .select("segment_map")
        .eq("project_id", projectId)
        .single(),
      supabase
        .from("ai_editor_actions")
        .select("action_type, outcome, char_count_original, char_count_result")
        .eq("project_id", projectId),
      supabase
        .from("project_stats")
        .select("*")
        .eq("project_id", projectId)
        .single(),
    ]);

    const writingContent = writingRes.data?.content ?? "";
    if (!writingContent || writingContent.trim().length === 0) {
      return jsonResponse({ error: "No writing to analyze" }, 400);
    }

    // --- Fetch chat messages across all threads ---
    const threadIds = (threadsRes.data ?? []).map((t: { id: string }) => t.id);
    const threadNameMap: Record<string, string> = {};
    for (const t of threadsRes.data ?? []) {
      threadNameMap[(t as { id: string; name: string }).id] = (t as { id: string; name: string }).name;
    }

    let chatMessages: Array<{
      created_at: string;
      role: string;
      content: string;
      source_type: string | null;
      flow_flag: string | null;
      thread_id: string;
      thread_name: string;
    }> = [];

    if (threadIds.length > 0) {
      const { data: msgs } = await supabase
        .from("chat_messages")
        .select("created_at, role, content, source_type, flow_flag, thread_id")
        .in("thread_id", threadIds)
        .order("created_at", { ascending: true });

      chatMessages = (msgs ?? []).map((m: Record<string, unknown>) => ({
        created_at: m.created_at as string,
        role: m.role as string,
        content: m.content as string,
        source_type: m.source_type as string | null,
        flow_flag: m.flow_flag as string | null,
        thread_id: m.thread_id as string,
        thread_name: threadNameMap[m.thread_id as string] ?? "Unknown",
      }));
    }

    // --- Build provenance-annotated writing ---
    const segmentMap = (provenanceRes.data?.segment_map as Array<{ start: number; end: number; type: string }>) ?? [];
    const annotatedWriting = buildProvenanceAnnotatedWriting(writingContent, segmentMap);

    // --- Build chat history string ---
    const chatHistoryStr = chatMessages.length > 0
      ? buildChatHistoryString(chatMessages)
      : "No chat history recorded.";

    // --- Build editor stats ---
    const editorStatsStr = buildEditorStatsString(editorActionsRes.data as Array<{
      action_type: string;
      outcome: string;
      char_count_original: number | null;
      char_count_result: number | null;
    }> ?? []);

    // --- Build full prompt ---
    const userPrompt = `Language: ${project.language}

=== PROVENANCE-ANNOTATED WRITING ===
${annotatedWriting}

=== CHAT HISTORY ===
${chatHistoryStr}

=== IMPORTED DOCUMENTS ===
None

=== AI EDITOR ACTIVITY ===
${editorStatsStr}`;

    // --- Call Anthropic with tool use ---
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) {
      return jsonResponse({ error: "Anthropic API key not configured" }, 500);
    }

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: FLOW_PROMPT_TEMPLATE,
        messages: [{ role: "user", content: userPrompt }],
        tools: [SUBMIT_FLOW_TOOL],
        tool_choice: { type: "tool", name: "submit_flow_analysis" },
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("Anthropic API error:", anthropicRes.status, errText);
      return jsonResponse(
        { error: "AI analysis service temporarily unavailable. Please try again." },
        502
      );
    }

    const anthropicData = await anthropicRes.json();

    // Extract tool_use result
    const toolUseBlock = anthropicData.content?.find(
      (block: { type: string }) => block.type === "tool_use"
    );

    if (!toolUseBlock?.input) {
      console.error("No tool_use block found in response:", JSON.stringify(anthropicData));
      return jsonResponse(
        { error: "AI analysis returned unexpected format. Please try again." },
        502
      );
    }

    const flowResult = toolUseBlock.input;

    // --- Capture metrics snapshot ---
    const metricsSnapshot = statsRes.data
      ? {
          total_active_time_seconds: statsRes.data.total_active_time_seconds,
          total_writing_time_seconds: statsRes.data.total_writing_time_seconds,
          chat_prompt_count_normal: statsRes.data.chat_prompt_count_normal,
          chat_prompt_count_tutor: statsRes.data.chat_prompt_count_tutor,
          sanity_check_count: statsRes.data.sanity_check_count,
        }
      : null;

    // --- Store FLOW report ---
    const { data: report, error: reportErr } = await supabase
      .from("flow_reports")
      .insert({
        project_id: projectId,
        ai_summary: flowResult.summary,
        ai_find: flowResult.find,
        ai_lead: flowResult.lead,
        ai_organize: flowResult.organize,
        ai_write: flowResult.write,
        metrics_snapshot: metricsSnapshot,
        model_used: "claude-sonnet-4-20250514",
      })
      .select()
      .single();

    if (reportErr) {
      console.error("Error storing FLOW report:", reportErr);
      return jsonResponse({ error: "Failed to store analysis report" }, 500);
    }

    // --- Log token usage ---
    const inputTokens = anthropicData.usage?.input_tokens ?? Math.ceil(userPrompt.length / 4);
    const outputTokens = anthropicData.usage?.output_tokens ?? Math.ceil(JSON.stringify(flowResult).length / 4);
    const totalTokens = inputTokens + outputTokens;

    await Promise.all([
      supabase.from("token_usage").insert({
        user_id: user.id,
        project_id: projectId,
        function_name: "analysis",
        model_used: "claude-sonnet-4-20250514",
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      }),
      supabase
        .from("profiles")
        .update({
          tokens_used_this_period: profile.tokens_used_this_period + totalTokens,
        })
        .eq("id", user.id),
    ]);

    return jsonResponse({
      report,
      tokens_used: totalTokens,
      budget_remaining: profile.monthly_token_budget - (profile.tokens_used_this_period + totalTokens),
    });
  } catch (err) {
    console.error("Analysis function error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
