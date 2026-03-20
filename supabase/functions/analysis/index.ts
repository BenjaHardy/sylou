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

// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// FLOW Prompt v1.2 – full text from Ethos_FLOW_Prompt.docx
// ---------------------------------------------------------------------------
const FLOW_PROMPT_TEMPLATE = `You are an expert analyst evaluating human-AI collaboration in a writing project. Your task is to assess how a human user collaborated with an AI assistant across four pillars: Find, Lead, Organize, and Write (the FLOW framework).

# INSTRUCTIONS

1. Read the complete project data below carefully.
2. For each of the four pillars, identify the key patterns across the ENTIRE project. Your assessment must reflect the overall project, not isolated moments.
3. For each pillar, cite 2-4 key evidence items that are REPRESENTATIVE of the overall pattern you observed. Evidence must span the breadth of the work (beginning, middle, and end for larger projects) to prevent clustering or cherry-picking. Each evidence item should be a brief quote or concrete reference to a specific moment in the chat history or writing.
4. For each pillar, write your REASONING before assigning a score. Explain how the evidence supports your assessment, consider alternative interpretations, and justify your score choice. This reasoning will be available to the user on request, so be thorough and fair.
5. Assign a score for each pillar using the rubric below. Use half-point increments (0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0) to reflect nuance. If there is insufficient evidence to assess a pillar, assign null instead of a numeric score.
6. Write a brief narrative for each pillar explaining the assessment in language accessible to the user.
7. Write an overall summary of the human-AI collaboration. Where applicable, highlight (i) significant user contributions and (ii) areas where the human-AI collaboration provided significant added value in a way that empowered the user and their work; if none, specify there are none.

# FLOW PILLAR DEFINITIONS

- F – Find (Research & Critical Thinking)
Identify how the user researched relevant topics, whether he questioned the AI's outputs, compared alternatives, or challenged suggestions — versus relying on the AI without investigation.

- L – Lead (Ideas & Opinions)
Determine who is the true source of the ideas, opinions and perspectives in the final work: the user (original thinking, own viewpoint) or the AI (suggestions heavily reused, ideas taken verbatim, reliance on AI-driven content).

- O – Organize (Structure & Argumentation)
Assess how the ideas, opinions and perspectives are structured, and how the narrative and argumentation — supporting those ideas, opinions and perspectives — are developed. Determine whether the user or the AI primarily shaped the outline, the logical progression, the argumentation, and the overall structure.

- W – Write (Writing & Text Production)
Analyze the respective contributions to tone, style, clarity, correctness, sentence structure, transitions, and final drafting. Identify whether the AI generated large portions of the prose, whether the user refined or rewrote the content, or whether the user wrote the content by himself. Pay attention to the provenance annotations ([t], [cc], [ce], [ai] tags) in the writing content to inform your Write pillar assessment.

# === SCORING CALIBRATION ===

To ensure consistent scoring, use the following reference points. These apply globally across all four pillars:

| Score | Label | Description |
|-------|-------|-------------|
| 5.0 | Only Human | The user produced this aspect of the work entirely independently. The AI was not involved, or the user explicitly disregarded AI contributions for this pillar. |
| 4.0 | Largely Human | The user originated the core content for this pillar (e.g. key ideas, overall structure, or prose). The AI provided minor support such as factual checks, light suggestions, or small refinements, but the user's contribution clearly dominates. |
| 3.0 | More Human | The user drove the direction and made the key decisions, but the AI made notable contributions that shaped the outcome. For example, the AI suggested a framework that the user substantially adapted, or the AI drafted a passage that the user significantly rewrote. |
| 2.0 | More AI | The AI produced the bulk of the material for this pillar, but the user made meaningful modifications, selections, or editorial decisions. The user engaged with the AI output rather than accepting it passively. |
| 1.0 | Largely AI | The AI generated nearly all of the content for this pillar. The user's contribution was limited to minor edits, superficial changes, or simple acceptance of AI output. |
| 0.0 | No human contribution detected | No evidence of human contribution for this pillar. The AI produced all relevant content and the user did not engage with, modify, or build upon it. |
| null | Insufficient evidence | There is not enough data to assess this pillar. This applies when the writing or chat history is too sparse to evaluate a particular pillar, or when the pillar is not applicable to the work produced. Use this instead of defaulting to 0. |

Half-point scores (e.g. 2.5, 3.5) are permitted and encouraged when the evidence falls between two reference points.

# RESPONSE FORMAT

Respond ONLY by calling the submit_flow_analysis tool with the required parameters. Do not produce any text outside the tool call.`;

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------
const pillarSchema = {
  type: "object" as const,
  required: ["reasoning", "evidence", "score", "narrative"],
  properties: {
    reasoning: { type: "string" as const, description: "Chain-of-thought reasoning before scoring" },
    evidence: {
      type: "array" as const,
      items: { type: "string" as const },
      minItems: 2,
      maxItems: 4,
    },
    score: { type: ["number", "null"] as const, minimum: 0, maximum: 5 },
    narrative: { type: "string" as const },
  },
};

const SUBMIT_FLOW_TOOL = {
  name: "submit_flow_analysis",
  description: "Submit the structured FLOW analysis results",
  input_schema: {
    type: "object" as const,
    required: ["summary", "find", "lead", "organize", "write"],
    properties: {
      summary: { type: "string" as const, description: "Overall summary paragraph" },
      find: pillarSchema,
      lead: pillarSchema,
      organize: pillarSchema,
      write: pillarSchema,
    },
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProvenanceAnnotatedWriting(
  content: string,
  segmentMap: Array<{ start: number; end: number; type: string }>
): string {
  if (!segmentMap || segmentMap.length === 0) {
    return `[t]${content}`;
  }

  const sorted = [...segmentMap].sort((a, b) => a.start - b.start);
  let result = "";
  let cursor = 0;

  for (const seg of sorted) {
    if (seg.start > cursor) {
      result += `[t]${content.slice(cursor, seg.start)}`;
    }
    const tag =
      seg.type === "typed" ? "[t]"
      : seg.type === "copy_chat" ? "[cc]"
      : seg.type === "copy_external" ? "[ce]"
      : seg.type === "ai" ? "[ai]"
      : `[${seg.type}]`;
    result += `${tag}${content.slice(seg.start, seg.end)}`;
    cursor = seg.end;
  }

  if (cursor < content.length) {
    result += `[t]${content.slice(cursor)}`;
  }

  return result;
}

/**
 * Compute aggregate character-count percentages per provenance type.
 */
function computeProvenanceStats(
  content: string,
  segmentMap: Array<{ start: number; end: number; type: string }>
): Record<string, number> {
  const totalLen = content.length;
  if (totalLen === 0) return { typed: 100, copy_chat: 0, copy_external: 0, ai: 0 };

  const counts: Record<string, number> = { typed: 0, copy_chat: 0, copy_external: 0, ai: 0 };

  if (!segmentMap || segmentMap.length === 0) {
    return { typed: 100, copy_chat: 0, copy_external: 0, ai: 0 };
  }

  const sorted = [...segmentMap].sort((a, b) => a.start - b.start);
  let cursor = 0;

  for (const seg of sorted) {
    if (seg.start > cursor) {
      counts["typed"] += seg.start - cursor;
    }
    const normType = seg.type === "typed" ? "typed"
      : seg.type === "copy_chat" ? "copy_chat"
      : seg.type === "copy_external" ? "copy_external"
      : seg.type === "ai" ? "ai"
      : seg.type;
    counts[normType] = (counts[normType] || 0) + (seg.end - seg.start);
    cursor = seg.end;
  }

  if (cursor < totalLen) {
    counts["typed"] += totalLen - cursor;
  }

  // Convert to percentages
  const result: Record<string, number> = {};
  for (const [key, val] of Object.entries(counts)) {
    result[key] = Math.round((val / totalLen) * 1000) / 10; // one decimal
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
  actions: Array<{
    action_type: string;
    outcome: string;
    char_count_original: number | null;
    char_count_result: number | null;
  }>
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

// ---------------------------------------------------------------------------
// Similarity detection: compare writing against AI assistant chat messages
// ---------------------------------------------------------------------------

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function ngrams(text: string, n: number): Set<string> {
  const words = text.split(" ");
  const out = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    out.add(words.slice(i, i + n).join(" "));
  }
  return out;
}

function computeSimilarityPct(
  writingContent: string,
  assistantMessages: string[]
): number {
  const normWriting = normalise(writingContent);
  if (!normWriting) return 0;

  const assistantNgrams = new Set<string>();
  for (const msg of assistantMessages) {
    const normMsg = normalise(msg);
    for (const ng of ngrams(normMsg, 5)) {
      assistantNgrams.add(ng);
    }
  }

  if (assistantNgrams.size === 0) return 0;

  const writingNgramsList = ngrams(normWriting, 5);
  if (writingNgramsList.size === 0) return 0;

  let matchCount = 0;
  for (const ng of writingNgramsList) {
    if (assistantNgrams.has(ng)) matchCount++;
  }

  return Math.round((matchCount / writingNgramsList.size) * 100);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

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

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // --- Parse body & validate project_id ---
    const body = await req.json();
    const projectId: string = body.project_id;
    if (!projectId || typeof projectId !== "string" || !UUID_RE.test(projectId)) {
      return jsonResponse({ error: "project_id must be a valid UUID" }, 400);
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

    // --- Fetch profile for budget (needed later) ---
    const { data: profile } = await supabase
      .from("profiles")
      .select("tokens_used_this_period, monthly_token_budget")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    // --- Fetch all project data in parallel ---
    const [writingRes, threadsRes, provenanceRes, editorActionsRes, statsRes] =
      await Promise.all([
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
    const threadIds = (threadsRes.data ?? []).map(
      (t: { id: string }) => t.id
    );
    const threadNameMap: Record<string, string> = {};
    for (const t of threadsRes.data ?? []) {
      threadNameMap[(t as { id: string; name: string }).id] = (
        t as { id: string; name: string }
      ).name;
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
    const segmentMap =
      (provenanceRes.data?.segment_map as Array<{
        start: number;
        end: number;
        type: string;
      }>) ?? [];
    const annotatedWriting = buildProvenanceAnnotatedWriting(
      writingContent,
      segmentMap
    );

    // --- Compute provenance statistics ---
    const provenanceStats = computeProvenanceStats(writingContent, segmentMap);
    const provenanceSection = `# === INPUT PROVENANCE DATA ===

Character-count breakdown by provenance type:
- Typed by user: ${provenanceStats.typed}%
- Copied from AI chat: ${provenanceStats.copy_chat}%
- Copied from external source: ${provenanceStats.copy_external}%
- AI-generated (editor): ${provenanceStats.ai}%`;

    // --- Build chat history string ---
    const chatHistoryStr =
      chatMessages.length > 0
        ? buildChatHistoryString(chatMessages)
        : "No chat history recorded.";

    // --- Build editor stats ---
    const editorStatsStr = buildEditorStatsString(
      (editorActionsRes.data as Array<{
        action_type: string;
        outcome: string;
        char_count_original: number | null;
        char_count_result: number | null;
      }>) ?? []
    );

    // --- Similarity detection ---
    const assistantMessages = chatMessages
      .filter((m) => m.role === "assistant")
      .map((m) => m.content);
    const similarityPct = computeSimilarityPct(writingContent, assistantMessages);

    // Build Write Pillar Notice if similarity >= 35%
    let writePillarNotice = "";
    if (similarityPct >= 35) {
      writePillarNotice = `\n# === WRITE PILLAR NOTICE ===\n\nAutomated similarity analysis detected that ${similarityPct}% of the writing content closely matches AI assistant responses from the chat history. This is a significant indicator for Write pillar scoring. Consider this alongside the provenance annotations ([t], [cc], [ce], [ai] tags) in the writing content.`;
    }

    // --- Build full prompt ---
    const userPrompt = `# LANGUAGE

Respond entirely in ${project.language}. All summaries, analyses, evidence items, reasoning, and narratives must be written in ${project.language}. Only JSON structure and field names remain in English.

# WRITING CONTENT (PROVENANCE-ANNOTATED)

The writing content below is annotated with provenance tags indicating the origin of each text segment. Use these annotations to inform your assessment, particularly for the Write pillar:

- [t] = typed by the user (original user writing, including text copied from the user's own chat messages)
- [cc] = copied from AI assistant chat messages (AI-originated text)
- [ce] = copied from an external source (neither user nor AI contribution)
- [ai] = AI-generated text accepted from the text selection window (the user selected text in their editor and requested an AI rewrite, expansion, simplification, or proposal, then accepted the result)

${annotatedWriting}

${provenanceSection}

# CHAT HISTORY

The following chat messages are from all project threads, merged in chronological order. Each message is prefixed with a timestamp and thread label.

Some messages originate from the text selection window, a feature that allows the user to select text in their editor and either ask the AI a question about it (Ask) or request the AI to propose a rewritten version (Propose). These messages are flagged with their source type below.

Writing summaries are marked "[NOT ASSESSED]" — they provide context for the subsequent discussion but should not be scored as either party's contribution, because they are AI-generated condensations of the writing and creative tools data at that point in time that may include contributions from any party. Consider the whole chat log and other contents to properly identify the respective contributions of each party, noting that new ideas or contributions appearing for the first time in a writing summary and not found in earlier chat messages would normally be user contributions unless copied from external sources.

${chatHistoryStr}

# === IMPORTED DOCUMENTS ===

The following documents were imported by the user as reference material. They are neither user nor AI contributions. If the writing closely mirrors imported document content, note this in your analysis but do not score it as AI contribution.

None

# === AI EDITOR ACTIVITY ===

The following statistics summarize AI-assisted editing actions performed via the text selection window. Predefined actions (grammar, rewrite, simplify, expand, translate) are counted. Ask and Propose interactions are also counted here but their full content appears in the Chat History above.

${editorStatsStr}
${writePillarNotice}`;

    // --- Budget check (after prompt is fully built) ---
    const fullPromptText = FLOW_PROMPT_TEMPLATE + userPrompt;
    const charEst = Math.ceil(fullPromptText.length / 4) * 1.1;
    const wordEst = fullPromptText.split(/\s+/).length * 1.3;
    const estimated = Math.ceil(Math.max(charEst, wordEst));
    const budgetRemaining =
      profile.monthly_token_budget - profile.tokens_used_this_period;

    if (budgetRemaining < estimated + 2000) {
      return jsonResponse(
        {
          error: `Insufficient token budget for FLOW analysis`,
          estimated_cost: estimated + 2000,
          budget_remaining: budgetRemaining,
        },
        403
      );
    }

    // --- Estimate input tokens for flow_meta ---
    const estimatedInputTokens = estimated;
    const contextLimitTokens = 1000000; // Claude Sonnet 4.6 context window

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
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
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
      console.error(
        "No tool_use block found in response:",
        JSON.stringify(anthropicData)
      );
      return jsonResponse(
        { error: "AI analysis returned unexpected format. Please try again." },
        502
      );
    }

    const flowResult = toolUseBlock.input;

    // Validate all required pillars are present
    const defaultPillar = { reasoning: "Insufficient data", evidence: [], score: null, narrative: "Could not be assessed." };
    if (!flowResult.find) flowResult.find = defaultPillar;
    if (!flowResult.lead) flowResult.lead = defaultPillar;
    if (!flowResult.organize) flowResult.organize = defaultPillar;
    if (!flowResult.write) flowResult.write = defaultPillar;
    if (!flowResult.summary) flowResult.summary = "Analysis could not produce a complete summary.";

    // --- Apply Write pillar score cap if similarity >= 35% ---
    if (
      similarityPct >= 35 &&
      flowResult.write?.score != null &&
      flowResult.write.score > 2.0
    ) {
      flowResult.write.score = 2.0;
      flowResult.write.narrative +=
        ` [Note: Write score capped at 2.0 due to automated similarity detection finding ${similarityPct}% overlap with AI chat responses.]`;
    }

    // --- Capture metrics snapshot (includes all stats fields) ---
    const metricsSnapshot = statsRes.data
      ? {
          total_active_time_seconds: statsRes.data.total_active_time_seconds,
          total_writing_time_seconds: statsRes.data.total_writing_time_seconds,
          chat_prompt_count_normal: statsRes.data.chat_prompt_count_normal,
          chat_prompt_count_tutor: statsRes.data.chat_prompt_count_tutor,
          sanity_check_count: statsRes.data.sanity_check_count,
          first_activity_at: statsRes.data.first_activity_at,
          last_activity_at: statsRes.data.last_activity_at,
          clock_anomaly_count: statsRes.data.clock_anomaly_count,
        }
      : null;

    // --- Build flow_meta with token metadata ---
    const inputTokens =
      anthropicData.usage?.input_tokens ?? estimatedInputTokens;
    const outputTokens =
      anthropicData.usage?.output_tokens ??
      Math.ceil(JSON.stringify(flowResult).length / 4);
    const totalTokens = inputTokens + outputTokens;

    const budgetRatio = profile.tokens_used_this_period / profile.monthly_token_budget;
    const tokenStatus = budgetRatio >= 1.0 ? "over" : budgetRatio >= 0.8 ? "near" : "ok";

    const flowMeta = {
      estimated_input_tokens: inputTokens,
      context_limit_tokens: contextLimitTokens,
      token_status: tokenStatus,
      measured_at: new Date().toISOString(),
      similarity_pct: similarityPct,
      write_score_capped: similarityPct >= 35,
    };

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
        flow_meta: flowMeta,
        model_used: "claude-sonnet-4-6",
      })
      .select()
      .single();

    if (reportErr) {
      console.error("Error storing FLOW report:", reportErr);
      return jsonResponse({ error: "Failed to store analysis report" }, 500);
    }

    // --- Log token usage & atomically increment budget ---
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    await Promise.all([
      supabase.from("token_usage").insert({
        user_id: user.id,
        project_id: projectId,
        function_name: "analysis",
        model_used: "claude-sonnet-4-6",
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      }),
      adminSupabase.rpc("increment_tokens_used", {
        user_uuid: user.id,
        amount: totalTokens,
      }),
    ]);

    return jsonResponse({
      report,
      tokens_used: totalTokens,
      budget_remaining: budgetRemaining - totalTokens,
    });
  } catch (err) {
    console.error("Analysis function error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
