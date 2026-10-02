import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { providerFor, envKeyFor } from "../_shared/_llm.ts";
import { annotateWritingWithProvenance } from "../_shared/_provenance.ts";
import { FLOW_TEMPERATURE, resolveTemperature } from "../_shared/_temperatures.ts";
import {
  FLOW_THINKING, FLOW_EFFORT, FLOW_MISTRAL_EFFORT, MISTRAL_REASONING_MODELS,
  resolveThinking, resolveEffort, resolveMistralEffort, resolveMaxTokens,
} from "../_shared/_thinking.ts";
import {
  ALLOWED_MODELS,
  CONTEXT_LIMIT_TOKENS,
  FALLBACK_CONTEXT_LIMIT_TOKENS,
  OUTPUT_BUDGETS,
} from "../_shared/_models.ts";
import { computeSimilarityPct } from "../_shared/_similarity.ts";
import { sliceSafe } from "../_shared/_text.ts";
import {
  FLOW_PROMPT_TEMPLATE,
  CREATIVE_FLOW_PROMPT_TEMPLATE,
  SUBMIT_FLOW_TOOL,
} from "./prompts.ts";
import {
  computeProvenanceStats,
  buildChatHistoryString,
  buildEditorStatsString,
} from "./sections.ts";
import { formatCreativeDataForAnalysis } from "./creative.ts";
import { attemptFlowCall, billFailedAttempt, isValidPillar } from "./attempt.ts";
import { resolveImportedDocs } from "./docs-budget.ts";

// Cost-policy ceiling for imported documents in a FLOW prompt, in tokens
// (~4 chars each; 2026-07 maintainer decision). Deliberately below every
// allowed model's context window: reference documents may enrich the
// analysis but must not dominate its cost. The effective allowance is
// min(this, what the model's window leaves after the never-truncated
// sections) — see the 3-tier budget in the handler.
const FLOW_IMPORTED_DOCS_BUDGET_TOKENS = 100_000;

// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, POST, OPTIONS");

// Generator provenance — captured at report-generation time so shared
// reports retain their origin metadata regardless of where they are viewed.
//
// Everything here is declared by the operator: the env vars, and is_modified,
// which forks that modify the source should set to true (shared reports and
// badges then flag a modified build). commit_hash can be compared with the
// release tags, but only the domain serving a shared report can be verified
// by a viewer: a report is as trustworthy as that domain's operator.
const SYLOU_INSTANCE_LABEL  = Deno.env.get("SYLOU_INSTANCE_LABEL")  ?? "self-hosted";
const SYLOU_INSTANCE_DOMAIN = Deno.env.get("SYLOU_INSTANCE_DOMAIN") ?? null;
const SYLOU_VERSION         = Deno.env.get("SYLOU_VERSION")         ?? "unknown";
const SYLOU_COMMIT_HASH     = Deno.env.get("SYLOU_COMMIT_HASH")     ?? "unknown";
const GENERATOR_INFO = {
  instance_label:  SYLOU_INSTANCE_LABEL,
  instance_domain: SYLOU_INSTANCE_DOMAIN,
  version:         SYLOU_VERSION,
  commit_hash:     SYLOU_COMMIT_HASH,
  is_modified:     false,
} as const;



// ---------------------------------------------------------------------------
// UUID validation
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Similarity detection lives in ../_shared/_similarity.ts (P3-7d): the
// writing side is HTML-stripped there before the 5-gram comparison. The
// ≥35% Write-score cap that consumes the result stays in this handler.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
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
      .select("id, language, tutor_mode, name, template")
      .eq("id", projectId)
      .single();

    if (projectErr || !project) {
      return jsonResponse({ error: "Project not found or not owned by user" }, 404);
    }

    // --- Fetch profile for budget (needed later) ---
    // Best-effort monthly budget-window reset (lazy; no-op if already current).
    await supabase.rpc("reset_tokens_if_stale", { user_uuid: user.id });
    const { data: profile } = await supabase
      .from("profiles")
      .select("tokens_used_this_period, monthly_token_budget, preferred_flow_model")
      .eq("id", user.id)
      .single();

    if (!profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    const isCreativeProject = project.template === "creative";

    // --- Resolve FLOW model (gated request override, else profile pref) ---
    // Gate the request override against the registry allowlist; an absent/
    // empty value falls back to the profile preference as before. Without
    // this, any authed caller could route to arbitrary provider models on
    // the operator's key (the shipped client never sends `model`). Mirrors
    // chat/editor-action/context-prompt (P2-6); analysis was the one LLM
    // function still ungated.
    const requestedModel: string | undefined = body.model;
    if (requestedModel && !ALLOWED_MODELS.has(requestedModel)) {
      return jsonResponse(
        { error: `Unsupported model: ${sliceSafe(String(requestedModel), 64)}` },
        400,
      );
    }
    const flowModel: string =
      requestedModel || profile.preferred_flow_model || "zai-glm-5-3";

    const provider = providerFor(flowModel);
    if (!Deno.env.get(envKeyFor(provider))) {
      return jsonResponse({ error: `${provider} API key not configured` }, 500);
    }

    // Resolve per-model knobs ONCE per request and bake into baseLlmArgs.
    // The retry path (attempt === 2 below) spreads baseLlmArgs, so it
    // inherits the exact same temperature — no second resolveTemperature()
    // call, no risk of mid-request drift if the table is edited. Resolved
    // this early because the imported-docs budget needs the model's context
    // window and output reserve before the prompt is assembled.
    const temperature = resolveTemperature(FLOW_TEMPERATURE, flowModel);
    const thinking = resolveThinking(FLOW_THINKING, flowModel);
    const effort = resolveEffort(FLOW_EFFORT, flowModel);
    const mistralEffort = resolveMistralEffort(FLOW_MISTRAL_EFFORT, flowModel);
    const flowMaxTokens = resolveMaxTokens(OUTPUT_BUDGETS.FLOW, flowModel, thinking, mistralEffort !== undefined);

    // The model's real context window (tokens), from the server-side mirror
    // of the src/lib/models.ts registry; conservative fallback for stale
    // legacy preference ids.
    const contextLimitTokens =
      CONTEXT_LIMIT_TOKENS[flowModel] ?? FALLBACK_CONTEXT_LIMIT_TOKENS;

    // --- Fetch all project data in parallel ---
    const fetchPromises = [
        supabase.from("writing_content").select("content").eq("project_id", projectId).single(),
        supabase.from("chat_threads").select("id, name").eq("project_id", projectId),
        supabase.from("provenance_events").select("segment_map").eq("project_id", projectId).single(),
        supabase.from("ai_editor_actions").select("action_type, outcome, char_count_original, char_count_result, selected_text_preview, ai_response_preview, instruction_text, created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
        supabase.from("project_stats").select("*").eq("project_id", projectId).single(),
        supabase.from("imported_documents").select("id, file_name, extracted_text, summary, file_size_bytes").eq("project_id", projectId),
        supabase.from("writing_versions").select("content, saved_at").eq("project_id", projectId).order("saved_at", { ascending: true }),
    ] as const;

    const creativeDataPromise = isCreativeProject
      ? supabase.from("project_creative_data").select("tool_type, data").eq("project_id", projectId)
      : Promise.resolve({ data: null });

    const [[writingRes, threadsRes, provenanceRes, editorActionsRes, statsRes, importedDocsRes, versionsRes], creativeDataRes] =
      await Promise.all([Promise.all(fetchPromises), creativeDataPromise]);

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
      documents_referenced?: string[] | null;
      web_searches_performed?: string[] | null;
    }> = [];

    if (threadIds.length > 0) {
      const { data: msgs } = await supabase
        .from("chat_messages")
        .select("created_at, role, content, source_type, flow_flag, thread_id, documents_referenced, web_searches_performed")
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
        documents_referenced: m.documents_referenced as string[] | null,
        web_searches_performed: m.web_searches_performed as string[] | null,
      }));
    }

    // --- Use provenance segments as-is (mapping-based tracking is accurate) ---
    const segmentMap =
      (provenanceRes.data?.segment_map as Array<{
        start: number;
        end: number;
        source?: string;
        type?: string;
      }>) ?? [];

    // --- Build provenance-annotated writing (position-aware; see _provenance.ts) ---
    const annotatedWriting = annotateWritingWithProvenance(
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

    // --- Build imported documents name map ---
    const importedDocs = (importedDocsRes.data ?? []) as Array<{
      id: string;
      file_name: string;
      extracted_text: string | null;
      summary: string | null;
      file_size_bytes: number | null;
    }>;
    const docNameMap: Record<string, string> = {};
    for (const doc of importedDocs) {
      docNameMap[doc.id] = doc.file_name;
    }

    // --- Build chat history string ---
    const chatHistoryStr =
      chatMessages.length > 0
        ? buildChatHistoryString(chatMessages, docNameMap)
        : "No chat history recorded.";

    // --- Build editor stats ---
    const editorStatsStr = buildEditorStatsString(
      (editorActionsRes.data as Array<{
        action_type: string;
        outcome: string;
        char_count_original: number | null;
        char_count_result: number | null;
        selected_text_preview: string | null;
        ai_response_preview: string | null;
        instruction_text: string | null;
        created_at: string;
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
      // CC BY-SA 4.0 methodology text (attribution doctrine: similarity
      // notice for the Write pillar) — see LICENSING.md.
      writePillarNotice = `\n# === WRITE PILLAR NOTICE ===\n\nAutomated similarity analysis detected that ${similarityPct}% of the writing content closely matches AI assistant responses from the chat history. This is a significant indicator for Write pillar scoring. Consider this alongside the provenance annotations ([t], [cc], [ce], [ai] tags) in the writing content.`;
    }

    // --- Build every non-docs prompt section first ---
    // The imported-docs budget below needs the true size of everything that
    // ships regardless of the docs decision, so every other section (creative
    // tools, editor activity, notices, and the template actually used) is
    // built and measured before the budget. The previous baseline missed the
    // creative section, the editor-activity section and the creative
    // template's length.
    const basePromptParts = [
      `# LANGUAGE\n\nRespond entirely in ${project.language}. All summaries, analyses, evidence items, reasoning, and narratives must be written in ${project.language}. Only JSON structure and field names remain in English.`,
      // CC BY-SA 4.0 methodology text (attribution doctrine: the
      // provenance-tag definitions) — see LICENSING.md.
      `# WRITING CONTENT (PROVENANCE-ANNOTATED)\n\nThe writing content below is annotated with provenance tags indicating the origin of each text segment. Use these annotations to inform your assessment, particularly for the Write pillar:\n\n- [t] = typed by the external third-party user (original user writing, including text copied from the user's own chat messages)\n- [cc] = copied from AI assistant chat messages (AI-originated text)\n- [ce] = copied from an external source (neither user nor AI contribution; pay attention not to wrongly attribute to user)\n- [ai] = AI-generated text accepted from the text selection window (the user selected text in their editor and requested an AI rewrite, expansion, simplification, or proposal, then accepted the result)\n\n${annotatedWriting}\n\n${provenanceSection}`,
      // CC BY-SA 4.0 methodology text (attribution doctrine: the
      // writing-summary "[NOT ASSESSED]" rule) — see LICENSING.md.
      `# CHAT HISTORY\n\nThe following chat messages between the AI and the external third-party user are from all project threads, merged in chronological order. Each message is prefixed with a timestamp and thread label.\n\nSome messages originate from the text selection window, a feature that allows the user to select text in their editor and either ask the AI a question about it (Ask) or request the AI to propose a rewritten version (Propose). These messages are flagged with their source type below.\n\nWriting summaries are marked "[NOT ASSESSED]" — they provide context for the subsequent discussion but should not be scored as either party's contribution, because they are AI-generated condensations of the writing and creative tools data at that point in time that may include contributions from any party. Consider the whole chat log and other contents to properly identify the respective contributions of each party, noting that new ideas or contributions appearing for the first time in a writing summary and not found in earlier chat messages would normally be user contributions unless copied from external sources.\n\n${chatHistoryStr}`,
    ];
    // --- Build creative tools section (if applicable) ---
    let creativeToolsSection = "";
    if (isCreativeProject && creativeDataRes.data && creativeDataRes.data.length > 0) {
      // CC BY-SA 4.0 methodology text (attribution doctrine: creative-tools
      // relevance to the Lead and Organize pillars) — see LICENSING.md.
      creativeToolsSection = `\n\n# === CREATIVE TOOLS CONTENT ===\n\nThe following content comes from the creative tools accessible by the external third-party user to help develop key story elements: world-building notes, character diagram, timeline. This content is critical for assessing the L – Lead pillar (directly) and O – Organize pillar (indirectly).\n\n${formatCreativeDataForAnalysis(creativeDataRes.data as any)}`;
    }

    const systemPromptTemplate = isCreativeProject ? CREATIVE_FLOW_PROMPT_TEMPLATE : FLOW_PROMPT_TEMPLATE;

    // CC BY-SA 4.0 methodology text in the creative arm below (attribution
    // doctrine: the same "[NOT ASSESSED]" rule, creative variant) — see
    // LICENSING.md.
    const chatHistoryNote = isCreativeProject
      ? `# CHAT HISTORY\n\nThe following chat messages are from all project threads, merged in chronological order. Each message is prefixed with a timestamp and thread label.\n\nSome messages originate from the text selection window, a feature that allows the user to select text in their editor or in the creative tools and either ask the AI a question about it (Ask – available for both the editor and the creative tools) or request the AI to propose a rewritten version (Propose – available solely for the editor). These messages are flagged with their source type below.\n\nWriting summaries are marked "[NOT ASSESSED]" — they provide context for the subsequent discussion but should not be scored as either party's contribution, because they are AI-generated condensations of the writing and creative tools data at that point in time that may include contributions from any party. Consider the whole chat log and other contents to properly identify the respective contributions of each party, noting that new ideas or contributions appearing for the first time in a writing summary and not found in earlier chat messages would normally be user contributions unless copied from external sources.\n\n${chatHistoryStr}`
      : basePromptParts[2]; // original chat history section

    // Whole user prompt minus the imported-docs payload; the docs decision
    // below slots into the IMPORTED DOCUMENTS section.
    // The IMPORTED DOCUMENTS section intro inside this template carries
    // CC BY-SA 4.0 methodology text (attribution doctrine: imported
    // documents are neither party's contribution) — see LICENSING.md. The
    // surrounding scaffolding is ordinary AGPL plumbing.
    const buildUserPrompt = (docs: string) => `${basePromptParts[0]}\n\n${basePromptParts[1]}${creativeToolsSection}\n\n${chatHistoryNote}

# === IMPORTED DOCUMENTS ===

The following documents were imported by the external third-party user as reference material. They are neither user nor AI contributions. If the writing closely mirrors imported document content, note this in your analysis but do not score it as AI contribution.

${docs}

# === AI EDITOR ACTIVITY ===

The following statistics summarize AI-assisted editing actions performed via the text selection window. Predefined actions (grammar, rewrite, simplify, expand, translate) are counted, with a detailed log of recent ones below. Propose interactions are listed with their outcome (accepted/modified/rejected/pending) and timestamp — their full content appears in the timestamped Chat History above. Ask interactions appear in the Chat History only.

${editorStatsStr}
${writePillarNotice}`;

    const baseChars = systemPromptTemplate.length + buildUserPrompt("").length;

    // --- 3-tier imported documents budget ---
    // Imported docs get the SMALLER of two independent ceilings (2026-07
    // maintainer decision):
    //   (a) cost policy — at most FLOW_IMPORTED_DOCS_BUDGET_TOKENS of docs
    //       per analysis, whatever the model;
    //   (b) window fit — the whole prompt plus the output reserve must fit
    //       the model's real context window. Only this term carries the ×0.8
    //       cushion (the char→token estimate is approximate); the policy
    //       term stays exact, so the configured number means what it says.
    // Writing, chat and creative content are NEVER truncated — they consume
    // the window first and only squeeze the docs allowance (possibly to ≤0,
    // which lands in the excluded tier).
    // 1 token ≈ 4 chars
    const windowRemainingChars =
      (contextLimitTokens - flowMaxTokens) * 4 - baseChars;
    const docsAllowanceChars = Math.min(
      FLOW_IMPORTED_DOCS_BUDGET_TOKENS * 4,
      Math.floor(windowRemainingChars * 0.8),
    );

    const {
      section: importedDocsSection,
      mode: importedDocsMode,
      totalChars: importedDocsTotalChars,
    } = resolveImportedDocs(importedDocs, docsAllowanceChars);

    // --- Build full prompt ---
    const userPrompt = buildUserPrompt(importedDocsSection);

    // --- Budget check (after prompt is fully built) ---
    const fullPromptText = systemPromptTemplate + userPrompt;
    const charEst = Math.ceil(fullPromptText.length / 4) * 1.1;
    const wordEst = fullPromptText.split(/\s+/).length * 1.3;
    const estimated = Math.ceil(Math.max(charEst, wordEst));
    const budgetRemaining: number | null =
      profile.monthly_token_budget === null
        ? null
        : profile.monthly_token_budget - profile.tokens_used_this_period;

    // Reserve the real configured output cap (a flat 2000 previously, which
    // understated reasoning models' 16k output budget).
    if (budgetRemaining !== null && budgetRemaining < estimated + flowMaxTokens) {
      return jsonResponse(
        {
          error: `Insufficient token budget for FLOW analysis`,
          estimated_cost: estimated + flowMaxTokens,
          budget_remaining: budgetRemaining,
        },
        403
      );
    }

    // --- Estimate input tokens for flow_meta ---
    const estimatedInputTokens = estimated;

    // --- Call LLM with tool use (provider-agnostic) ---
    // (model, per-model knobs and the context limit were resolved before
    // prompt assembly — the imported-docs budget needed them)
    if (provider === "anthropic") {
      console.log("FLOW tool schema sent to Claude", {
        model: flowModel,
        tool_name: SUBMIT_FLOW_TOOL.name,
        input_schema: JSON.stringify(SUBMIT_FLOW_TOOL.input_schema),
      });
    }

    // Anthropic Sonnet 4.6 / Opus 4.7+ support Structured Outputs (GA, no
    // beta header). This is the proper fix for the stringified-pillar bug:
    // the JSON object is returned in response.content[0].text and is
    // schema-validated server-side. We branch only the request shape — the
    // synthesized tool-call wrapper in normaliseResponse keeps downstream
    // code identical to the tool_use path.
    const useStructuredOutputs = provider === "anthropic";

    const baseLlmArgs = useStructuredOutputs
      ? {
          model: flowModel,
          max_tokens: flowMaxTokens,
          messages: [
            { role: "system" as const, content: systemPromptTemplate },
            { role: "user" as const, content: userPrompt },
          ],
          json_schema: {
            name: SUBMIT_FLOW_TOOL.name,
            schema: SUBMIT_FLOW_TOOL.input_schema as Record<string, unknown>,
          },
          temperature,
          thinking,
          effort,
          timeoutMs: 145_000, // hosted request-idle limit is 150s — fail in-contract before the platform 504
        }
      : {
          model: flowModel,
          max_tokens: flowMaxTokens,
          messages: [
            { role: "system" as const, content: systemPromptTemplate },
            { role: "user" as const, content: userPrompt },
          ],
          tools: [{
            type: "function" as const,
            function: {
              name: SUBMIT_FLOW_TOOL.name,
              description: SUBMIT_FLOW_TOOL.description,
              parameters: SUBMIT_FLOW_TOOL.input_schema,
            },
          }],
          forceTool: SUBMIT_FLOW_TOOL.name,
          disableParallelToolUse: true,
          temperature,
          mistral_effort: mistralEffort,
          timeoutMs: 145_000, // hosted request-idle limit is 150s — fail in-contract before the platform 504
        };

    // Attempt 1 — original prompt, with repair applied.
    // Admin client for billing — created before the attempts so failure
    // paths can bill too; the success path below reuses it.
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    // Everything the attempt helpers (attempt.ts) used to close over.
    // jsonResponse carries the per-request CORS headers, so the handler's
    // own closure is passed through — never rebuilt on the other side.
    const attemptDeps = {
      baseLlmArgs,
      systemPromptTemplate,
      userPrompt,
      flowModel,
      provider,
      temperature,
      useStructuredOutputs,
      projectId,
      jsonResponse,
    };
    const billingDeps = {
      supabase,
      adminSupabase,
      userId: user.id,
      projectId,
      flowModel,
    };

    let attemptResult = await attemptFlowCall(1, attemptDeps);

    // Attempt 2 — only if attempt 1 failed validation AFTER repair.
    // Skip retry on deterministic failures (refusal, max_tokens) — retrying
    // them would only burn tokens and mask the underlying signal.
    if (!attemptResult.ok && !attemptResult.noRetry) {
      // Bill the failed first attempt (history row + budget counter).
      await billFailedAttempt(attemptResult.failureLabel ?? "analysis:schema_invalid", attemptResult.usage, billingDeps);

      console.log("[FLOW retry] attempt 1 failed schema validation, retrying");
      attemptResult = await attemptFlowCall(2, attemptDeps);

      if (!attemptResult.ok) {
        console.log("[FLOW retry] attempt 2 also failed, returning 502");
        await billFailedAttempt(attemptResult.failureLabel ?? "analysis:schema_invalid", attemptResult.usage, billingDeps);
        return attemptResult.errorResponse;
      }

      console.log("[FLOW retry] attempt 2 succeeded");
    } else if (!attemptResult.ok) {
      // noRetry path (refusal / max_tokens): bill the attempt — the provider
      // charged for it — then return the prepared error.
      await billFailedAttempt(attemptResult.failureLabel ?? "analysis:failed", attemptResult.usage, billingDeps);
      return attemptResult.errorResponse;
    }

    const flowResult = attemptResult.flowResult as Record<string, any>;
    // Repairs from the WINNING attempt only (a failed attempt's repairs are
    // discarded with its result) — disclosed in flow_meta below.
    const repairedPillars = attemptResult.repairedPillars;
    const anthropicData = { usage: attemptResult.usage };
    const defaultPillar = { reasoning: "Insufficient data", evidence: [], score: null, narrative: "Could not be assessed." };

    // Sections replaced with defaults are recorded — never silently
    // substituted (engineering-standards §5) — and disclosed in flow_meta.
    const defaultedSections: string[] = [];
    if (!isValidPillar(flowResult.find)) { flowResult.find = defaultPillar; defaultedSections.push("find"); }
    if (!isValidPillar(flowResult.lead)) { flowResult.lead = defaultPillar; defaultedSections.push("lead"); }
    if (!isValidPillar(flowResult.organize)) { flowResult.organize = defaultPillar; defaultedSections.push("organize"); }
    if (!isValidPillar(flowResult.write)) { flowResult.write = defaultPillar; defaultedSections.push("write"); }
    if (!flowResult.summary || typeof flowResult.summary !== "string") {
      flowResult.summary = "Analysis could not produce a complete summary.";
      defaultedSections.push("summary");
    }

    // Score integrity (engineering-standards §5): a pillar score must be a
    // number in [0, 5] or null. Schema enforcement varies by provider (forced
    // tool-calling relies on prompt compliance), so normalize here — BEFORE
    // the similarity cap below, which must compare against a real number —
    // and disclose every change in flow_meta. Number() keeps half-points
    // intact ("4.5" → 4.5) and, unlike parseFloat, rejects trailing garbage
    // ("4.5x" → NaN → nulled) instead of guessing.
    for (const key of ["find", "lead", "organize", "write"] as const) {
      const pillar = flowResult[key] as Record<string, unknown>;
      const raw = pillar.score;
      if (raw === null) continue;
      if (typeof raw === "number" && raw >= 0 && raw <= 5) continue;
      const coerced = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (Number.isFinite(coerced) && coerced >= 0 && coerced <= 5) {
        pillar.score = coerced;
        repairedPillars.push(`${key}.score`);
        console.warn("[FLOW score repair] string score coerced to number", { pillar: key, raw });
      } else {
        pillar.score = null;
        defaultedSections.push(`${key}.score`);
        console.warn("[FLOW score default] invalid score set to null", { pillar: key, raw });
      }
    }

    // --- Apply Write pillar score cap if similarity >= 35% ---
    if (
      similarityPct >= 35 &&
      flowResult.write?.score != null &&
      flowResult.write.score > 2.0
    ) {
      flowResult.write.score = 2.0;
      // CC BY-SA 4.0 methodology text (attribution doctrine: the Write-score
      // cap disclosure) — see LICENSING.md.
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

    // NULL budget = no limit set, so no pressure — ratio 0 acts as headroom.
    const budgetRatio = profile.monthly_token_budget === null
      ? 0
      : profile.tokens_used_this_period / profile.monthly_token_budget;
    const tokenStatus = budgetRatio >= 1.0 ? "over" : budgetRatio >= 0.8 ? "near" : "ok";

    // Reasoning disclosure fields (provider-agnostic). All three are `null`
    // for models without reasoning controls (DeepSeek, non-reasoning Mistral).
    // The display layer switches on reasoning_provider to format correctly.
    let reasoningProvider: string | null = null;
    let reasoningThinking: boolean | null = null;
    let reasoningEffort: string | null = null;
    if (provider === "anthropic") {
      reasoningProvider = "anthropic";
      reasoningThinking = typeof thinking === "boolean" ? thinking : null;
      reasoningEffort = effort ?? null;
    } else if (MISTRAL_REASONING_MODELS.has(flowModel)) {
      reasoningProvider = "mistral";
      reasoningThinking = null;
      // Raw configured effort for disclosure — diverges from the wire-call
      // value (mistralEffort, baked into baseLlmArgs above) which resolves
      // "none" to undefined so the field is omitted from the Mistral API
      // request body.
      // Fallback to "none" defends against a future model being added to
      // MISTRAL_REASONING_MODELS without a corresponding FLOW_MISTRAL_EFFORT
      // entry — silent missing disclosure would be worse than a sane default.
      reasoningEffort = FLOW_MISTRAL_EFFORT[flowModel] ?? "none";   // "low" | "high" | "max" | "none"
    }

    const flowMeta: Record<string, unknown> = {
      estimated_input_tokens: inputTokens,
      context_limit_tokens: contextLimitTokens,
      token_status: tokenStatus,
      measured_at: new Date().toISOString(),
      similarity_pct: similarityPct,
      write_score_capped: similarityPct >= 35,
      imported_documents_mode: importedDocsMode,
      imported_documents_count: importedDocs.length,
      imported_documents_total_chars: importedDocsTotalChars,
      // The applied docs allowance: min(cost policy, window remainder) in
      // chars — discloses which ceiling squeezed the docs decision above.
      imported_documents_char_budget: docsAllowanceChars,
      // `null` means the provider controls the temperature (e.g. Opus 4.7+
      // which 400s on any non-default value); a number means we explicitly
      // requested that value. Surfaced in the FLOW report disclosure line.
      temperature_used: temperature ?? null,
      reasoning_provider: reasoningProvider,
      reasoning_thinking: reasoningThinking,
      reasoning_effort: reasoningEffort,
      // Engineering-standards §5 disclosure. repaired_pillars: pillar keys
      // whose stringified JSON the repair layer re-parsed, plus
      // "<pillar>.score" entries for numeric-string scores coerced to
      // numbers. defaulted_sections: sections replaced with the "Could not
      // be assessed" default, plus "<pillar>.score" entries for invalid
      // scores nulled by validation. Empty when clean.
      repaired_pillars: repairedPillars,
      defaulted_sections: defaultedSections,
      ...(isCreativeProject ? { template: "creative" } : {}),
    };

    // --- Build replay snapshot ---
    const replayEvents: Array<{ timestamp: string; type: string; content: Record<string, unknown> }> = [];

    // Writing versions
    for (const v of (versionsRes.data ?? []) as Array<{ content: string; saved_at: string }>) {
      replayEvents.push({
        timestamp: v.saved_at,
        type: "writing_version",
        content: { html: v.content },
      });
    }

    // Chat messages (already fetched)
    for (const m of chatMessages) {
      replayEvents.push({
        timestamp: m.created_at,
        type: "chat_message",
        content: {
          role: m.role,
          // Full message (2026-07-15 maintainer decision): the replay
          // should disclose the project's whole evolution and match what
          // FLOW itself read. Also removes a split-surrogate jsonb hazard.
          content: m.content,
          thread_name: m.thread_name,
          source_type: m.source_type,
        },
      });
    }

    // AI editor actions
    for (const a of (editorActionsRes.data ?? []) as Array<{
      action_type: string; outcome: string; created_at: string;
      selected_text_preview?: string | null; ai_response_preview?: string | null;
      [k: string]: unknown;
    }>) {
      replayEvents.push({
        timestamp: a.created_at,
        type: "ai_editor_action",
        content: {
          action_type: a.action_type,
          outcome: a.outcome,
          selected_text_preview: a.selected_text_preview ?? null,
          ai_response_preview: a.ai_response_preview ?? null,
        },
      });
    }

    // Sort chronologically
    replayEvents.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    // --- Store FLOW report ---
    // Service-role write (write-surface lockdown, CLAUDE.md §4): the user
    // INSERT policy on flow_reports was dropped in 20260924120000 so a
    // report row can only come from this function — never forged through
    // a direct PostgREST insert and then shared as if Sylou produced it.
    // Ownership was verified at request entry (the RLS-scoped project
    // fetch above), and user_id never enters this row: the report is
    // reached through project_id → projects.user_id.
    const { data: report, error: reportErr } = await adminSupabase
      .from("flow_reports")
      .insert({
        project_id: projectId,
        ai_summary: flowResult.summary,
        ai_find: flowResult.find,
        ai_lead: flowResult.lead,
        ai_organize: flowResult.organize,
        ai_write: flowResult.write,
        key_user_contributions: Array.isArray(flowResult.key_user_contributions) ? flowResult.key_user_contributions : [],
        metrics_snapshot: metricsSnapshot,
        flow_meta: flowMeta,
        provenance_snapshot: segmentMap,
        model_used: flowModel,
        project_name: project.name ?? null,
        replay_snapshot: replayEvents,
        writing_snapshot: writingContent,
        generator_info: GENERATOR_INFO,
      } as any)
      .select()
      .single();

    if (reportErr) {
      console.error("Error storing FLOW report:", reportErr);
      return jsonResponse({ error: "Failed to store analysis report" }, 500);
    }

    // --- Log token usage & atomically increment budget ---
    // (adminSupabase is created above the attempt orchestration.)
    const [successUsageRes, successRpcRes] = await Promise.all([
      supabase.from("token_usage").insert({
        user_id: user.id,
        project_id: projectId,
        function_name: "analysis",
        model_used: flowModel,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      }),
      adminSupabase.rpc("increment_tokens_used", {
        user_uuid: user.id,
        amount: totalTokens,
      }),
    ]);
    if (successUsageRes.error) console.error("[analysis] token_usage insert failed:", JSON.stringify(successUsageRes.error));
    if (successRpcRes.error) console.error("[analysis] increment_tokens_used failed:", JSON.stringify(successRpcRes.error));

    return jsonResponse({
      report,
      tokens_used: totalTokens,
      budget_remaining: budgetRemaining === null ? null : budgetRemaining - totalTokens,
    });
  } catch (err) {
    console.error("Analysis function error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
