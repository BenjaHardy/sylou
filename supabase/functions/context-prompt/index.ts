import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { callLLM, providerFor, normaliseResponse, extractProviderError, cleanLLMContent, type LLMTool } from "../_shared/_llm.ts";
import { makeSSEHelpers, readProviderStream, replayTokenBurst } from "../_shared/_sse.ts";
import { searchWeb, buildDocumentTool, buildWebSearchTool, formatWebSearchResults } from "../_shared/_tools.ts";
import { CONTEXT_TEMPERATURE, resolveTemperature } from "../_shared/_temperatures.ts";
import { ALLOWED_MODELS, INPUT_LIMITS } from "../_shared/_models.ts";
import { sliceSafe } from "../_shared/_text.ts";
import {
  CONTEXT_THINKING, CONTEXT_EFFORT, CONTEXT_MISTRAL_EFFORT,
  resolveThinking, resolveEffort, resolveMistralEffort, resolveMaxTokens,
  type ClaudeEffort, type MistralEffort,
} from "../_shared/_thinking.ts";
import {
  buildMemoryInjection,
  fetchConversationMemory,
  maybeRefreshConversationMemory,
} from "../_shared/_conversation_memory.ts";

import { isOverBudget, getBudgetedProfile } from "../_shared/_billing.ts";


// Service-role client for ai_editor_actions (bypasses RLS)
function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey);
}

// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, POST, OPTIONS");

// ── helpers ──────────────────────────────────────────────────────────────────

// Real tool executions per assistant turn; calls past this (and unknown
// tool names) still get a stub result — every echoed tool_call MUST be
// answered or the follow-up provider request 400s for the unpaired ids
// (P3-7e).
const TOOL_CALL_LIMIT = 5;

async function callChatModel(
  model: string,
  messages: { role: string; content: string }[],
  maxTokens = 2000,
  temperature?: number,
  thinking?: boolean,
  effort?: ClaudeEffort,
  mistralEffort?: MistralEffort,
): Promise<{ text: string; inputChars: number; outputChars: number }> {
  const res = await callLLM({
    model,
    messages: messages as any,
    max_tokens: maxTokens,
    temperature,
    thinking,
    effort,
    mistral_effort: mistralEffort,
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("LLM API error:", res.status, errText);
    throw new Error(extractProviderError(providerFor(model), res.status, errText));
  }

  const data = await res.json();
  let rawText = "";
  if (providerFor(model) === "anthropic") {
    const blocks: any[] = data?.content ?? [];
    rawText = blocks.filter(b => b?.type === "text").map(b => b.text ?? "").join("");
  } else {
    rawText = data.choices?.[0]?.message?.content ?? "";
  }
  const text = cleanLLMContent(rawText);
  const inputChars = messages.reduce((s, m) => s + m.content.length, 0);
  return { text, inputChars, outputChars: text.length };
}

// ── Creative data formatting helpers ─────────────────────────────────────────

function stripHtmlDeno(html: string): string {
  if (!html) return "";
  // No DOMParser global in the Deno/Supabase edge runtime (browser-only API),
  // so a DOM-parse branch throws on every call — regex-strip is what runs.
  return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function formatCreativeDataForSummary(
  creativeRows: Array<{ tool_type: string; data: Record<string, unknown> }>
): string {
  if (!creativeRows || creativeRows.length === 0) return "";

  const sections: string[] = [];

  for (const row of creativeRows) {
    if (row.tool_type === "worldbuilding") {
      const cats = (row.data as any)?.categories as Array<{
        name: string;
        notes: Array<{ title: string; subcategory: string; content: string }>;
      }> ?? [];
      if (cats.length === 0) continue;
      const lines = ["--- World-Building Notes ---"];
      for (const cat of cats) {
        for (const note of (cat.notes ?? [])) {
          const text = stripHtmlDeno(note.content);
          if (text) {
            lines.push(`[${cat.name} / ${note.subcategory}] ${note.title}: ${text}`);
          }
        }
      }
      if (lines.length > 1) sections.push(lines.join("\n"));
    }

    if (row.tool_type === "characters") {
      const chars = (row.data as any)?.characters as Array<{
        id: string; name: string; description: string; traits: string[];
      }> ?? [];
      const rels = (row.data as any)?.relationships as Array<{
        from_id: string; to_id: string; type_id: string; notes: string;
      }> ?? [];
      const relTypes = (row.data as any)?.relationshipTypes as Array<{
        id: string; label: string;
      }> ?? [];
      if (chars.length === 0) continue;

      const nameMap = new Map(chars.map(c => [c.id, c.name]));
      const lines = ["--- Character Diagram ---"];
      for (const c of chars) {
        let line = `- ${c.name}`;
        if (c.description) line += `: ${c.description}`;
        if (c.traits?.length) line += ` [Traits: ${c.traits.join(", ")}]`;
        lines.push(line);
      }
      if (rels.length > 0) {
        lines.push("Relationships:");
        for (const r of rels) {
          const fromName = nameMap.get(r.from_id) ?? "?";
          const toName = nameMap.get(r.to_id) ?? "?";
          const typeLabel = relTypes.find(t => t.id === r.type_id)?.label ?? "?";
          let line = `  ${fromName} → ${toName} (${typeLabel})`;
          if (r.notes) line += ` — ${r.notes}`;
          lines.push(line);
        }
      }
      sections.push(lines.join("\n"));
    }

    if (row.tool_type === "timeline") {
      const events = (row.data as any)?.events as Array<{
        title: string; date: string; description: string; order: number;
        character_ids: string[];
      }> ?? [];
      if (events.length === 0) continue;

      // Need character names from characters row
      const charsRow = creativeRows.find(r => r.tool_type === "characters");
      const chars = (charsRow?.data as any)?.characters as Array<{ id: string; name: string }> ?? [];
      const nameMap = new Map(chars.map(c => [c.id, c.name]));

      const sorted = [...events].sort((a, b) => a.order - b.order);
      const lines = ["--- Timeline ---"];
      for (const e of sorted) {
        let line = `- ${e.date ? `[${e.date}] ` : ""}${e.title}`;
        if (e.description) line += `: ${e.description}`;
        if (e.character_ids?.length) {
          const names = e.character_ids.map(id => nameMap.get(id) ?? "?").join(", ");
          line += ` [Characters: ${names}]`;
        }
        lines.push(line);
      }
      sections.push(lines.join("\n"));
    }
  }

  if (sections.length === 0) return "";
  return "\n\n=== CREATIVE WRITING TOOLS ===\n\n" + sections.join("\n\n");
}

// ── Prompt builders ─────────────────────────────────────────────────────────

function buildSummaryPrompt(
  writingContent: string,
  existingSummary: string | null,
  selectedText: string,
  instruction: string,
  sourceModule: string,
  language: string,
  creativeDataSection: string = "",
): { role: string; content: string }[] {
  const prompt = `You are a writing analysis assistant. Respond in ${language}.

Your task is to produce a brief, focused summary of the user's current writing project, relevant to answering a specific question or fulfilling a specific request.

=== CURRENT WRITING ===
${writingContent}
${creativeDataSection}

=== EXISTING WRITING SUMMARY (if any) ===
${existingSummary ?? "None"}

=== USER'S SELECTED TEXT ===
${selectedText}

=== USER'S QUESTION/REQUEST ===
${instruction}

=== SOURCE MODULE ===
${sourceModule}

=== YOUR TASK ===
- Produce a brief summary of the writing that includes ONLY information needed to answer the user's question or fulfill their request effectively. Be concise and specific.

CRITICAL RULES — follow exactly:

1. If an EXISTING WRITING SUMMARY is provided above AND it already covers
   all information needed to answer the user's question:
   → Reply with exactly: "No update needed."

2. If an EXISTING WRITING SUMMARY is provided above BUT additional details
   from the writing are needed:
   → Start your reply with "Additionally, " and provide ONLY the new facts.
   → Do NOT repeat anything from the existing summary.

3. If NO existing summary exists (it says "None"):
   → Start with "Writing currently includes..." and write a fresh summary.

FORMAT:
- Keep under 300 words. 
- State only facts from the writing — no analysis or recommendations.
- Focus on aspects relevant to the user's question
- Include character traits, plot points, arguments, or structural elements ONLY if they are needed to provide a good response`;

  return [
    { role: "system", content: prompt },
    { role: "user", content: `Please analyze the writing and produce a summary relevant to: "${instruction}"` },
  ];
}

function buildResponsePrompt(
  systemPrompt: string,
  updatedSummary: string,
  selectedText: string,
  instruction: string,
  sourceModule: string,
  recentChat: { role: string; content: string }[],
  actionType: "ask" | "propose",
  language: string,
  conversationMemory: string | null = null,
): { role: string; content: string }[] {
  const taskInstruction =
    actionType === "ask"
      ? "Respond to the user's question with informed, specific feedback based on the writing context provided. Reference specific aspects of their work. Be helpful and constructive."
      : "Produce a revised version of the selected text that fulfills the user's request. Provide ONLY the proposed replacement text, without explanation or commentary. The user will have the option to accept, modify, or reject your proposal.";

  const chatHistory = recentChat.length > 0
    ? recentChat.map((m) => `${m.role}: ${m.content}`).join("\n")
    : "No previous messages.";

  const contextPrompt = `${systemPrompt}

Respond in ${language}.

=== WRITING CONTEXT ===
The following is a summary of the user's current writing, relevant to their request:
${updatedSummary}

=== SELECTED TEXT ===
The user selected the following text in their ${sourceModule}:
"${selectedText}"

=== USER'S REQUEST ===
${instruction}

${conversationMemory ? `${buildMemoryInjection(conversationMemory)}\n\n` : ""}=== RECENT CHAT HISTORY ===
${chatHistory}

=== YOUR TASK ===
${taskInstruction}`;

  return [
    { role: "system", content: contextPrompt },
    { role: "user", content: instruction },
  ];
}

// ── Main handler ────────────────────────────────────────────────────────────

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

    // --- Token budget + preferred chat model ---
    const { profile, profileErr } = await getBudgetedProfile(supabase, user.id);

    if (profileErr || !profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    // Past the auth/profile guards above, user & profile are non-null. Capture
    // them here so nested closures (persistResults) keep the narrowed types —
    // TS doesn't propagate outer narrowing into inner function scopes.
    const authedUser = user;
    const authedProfile = profile;

    if (isOverBudget(profile)) {
      return jsonResponse({ error: "Monthly token budget exceeded" }, 403);
    }

    // Resolve chat model (request override allowed); validate provider key exists.
    const requestedModel: string | undefined = (await req.clone().json().catch(() => ({})))?.model;
    // Registry allowlist for the request override — see chat/index.ts for rationale.
    if (requestedModel && !ALLOWED_MODELS.has(requestedModel)) {
      return jsonResponse(
        { error: `Unsupported model: ${sliceSafe(String(requestedModel), 64)}` },
        400,
      );
    }
    const chatModel: string =
      requestedModel || profile.preferred_chat_model || "mistral-medium-3-5";
    const provider = providerFor(chatModel);
    const temperature = resolveTemperature(CONTEXT_TEMPERATURE, chatModel);
    const thinking = resolveThinking(CONTEXT_THINKING, chatModel);
    const effort = resolveEffort(CONTEXT_EFFORT, chatModel);
    const mistralEffort = resolveMistralEffort(CONTEXT_MISTRAL_EFFORT, chatModel);
    const contextMaxTokens = resolveMaxTokens(2000, chatModel, thinking, mistralEffort !== undefined);
    const summaryMaxTokens = resolveMaxTokens(1000, chatModel, thinking, mistralEffort !== undefined);
    const providerKeyEnv = provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "deepseek" ? "DEEPSEEK_API_KEY" : "MISTRAL_API_KEY";
    if (!Deno.env.get(providerKeyEnv)) {
      return jsonResponse({ error: `${provider} API key not configured` }, 500);
    }

    // --- Parse body ---
    const body = await req.json();
    const { project_id, thread_id, action_type, selected_text, instruction, source_module } = body;
    const selectedTextSource: string | undefined = body.selected_text_source;
    const streamRequested: boolean = body.stream === true;
    const webSearchEnabled: boolean = body.web_search_enabled ?? false;

    // ── CONFIRM endpoint ────────────────────────────────────────────────
    if (body.confirm !== undefined) {
      const { confirm, action_id, modified } = body;
      const adminClient = getAdminClient();

      // --- Ownership gate: CONFIRM returns before the main-path projects
      // check and uses the RLS-bypassing service-role client, so it must
      // verify ownership manually. Read via the RLS-scoped `supabase` client —
      // a row comes back only if the caller owns this project. maybeSingle()
      // keeps "not owned" a clean null (fail-closed) rather than a PGRST116.
      const { data: confirmProject } = await supabase
        .from("projects")
        .select("id, tutor_mode")
        .eq("id", project_id)
        .maybeSingle();
      if (!confirmProject) {
        return jsonResponse({ error: "Project not found or not owned by user" }, 404);
      }

      // --- Atomic pending-gate: only the FIRST decision for an action row
      // transitions it out of 'pending'. Replays, accept↔reject flips and
      // concurrent double-submits match zero rows here and no-op idempotently.
      // CONFIRM records ONLY the decision — the exchange itself (prompt,
      // summary delta, proposal) was already logged at delivery in the main
      // path (TRANSPARENCY.md §5.1), so nothing is written to the chat or the
      // summary log here.
      if (!action_id || typeof action_id !== "string") {
        // No ledger row to transition (the Propose-time insert failed).
        return jsonResponse({ ok: true, inserted_messages: [], already_resolved: true });
      }
      const outcome = !confirm ? "rejected" : modified ? "modified" : "accepted";
      const { data: transitioned, error: gateErr } = await adminClient
        .from("ai_editor_actions")
        .update({ outcome })
        .eq("id", action_id)
        .eq("project_id", project_id)
        .eq("outcome", "pending")
        .select("id")
        .maybeSingle();
      if (gateErr) {
        console.error("CONFIRM pending-gate update failed:", JSON.stringify(gateErr));
        return jsonResponse({ error: "Failed to record decision" }, 500);
      }
      if (!transitioned) {
        // Unknown id, not owned, or already decided — nothing written.
        return jsonResponse({ ok: true, inserted_messages: [], already_resolved: true });
      }

      // Decision recorded. inserted_messages stays in the response shape for
      // older clients (always empty — delivery already logged the exchange).
      return jsonResponse({ ok: true, inserted_messages: [] });
    }

    // ── Main context-prompt flow ────────────────────────────────────────
    if (!project_id || !thread_id || !action_type || !selected_text || !instruction || !source_module) {
      return jsonResponse(
        { error: "project_id, thread_id, action_type, selected_text, instruction, and source_module are required" },
        400,
      );
    }
    if (typeof selected_text !== "string" || selected_text.length > INPUT_LIMITS.SELECTED_TEXT_CHARS) {
      return jsonResponse(
        { error: `Selection is too long (max ${INPUT_LIMITS.SELECTED_TEXT_CHARS.toLocaleString("en-US")} characters)` },
        400,
      );
    }
    if (typeof instruction !== "string" || instruction.length > INPUT_LIMITS.INSTRUCTION_CHARS) {
      return jsonResponse(
        { error: `Instruction is too long (max ${INPUT_LIMITS.INSTRUCTION_CHARS.toLocaleString("en-US")} characters)` },
        400,
      );
    }
    if (selectedTextSource !== undefined && (typeof selectedTextSource !== "string" || selectedTextSource.length > INPUT_LIMITS.SHORT_FIELD_CHARS)) {
      return jsonResponse({ error: "Invalid selected_text_source" }, 400);
    }

    if (!["ask", "propose"].includes(action_type)) {
      return jsonResponse({ error: "action_type must be 'ask' or 'propose'" }, 400);
    }

    // --- Verify project ownership & get language ---
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id, tutor_mode, language, template")
      .eq("id", project_id)
      .single();

    if (projectErr || !project) {
      return jsonResponse({ error: "Project not found or not owned by user" }, 404);
    }

    const projectLanguage = project.language ?? "English";

    // --- 1. Fetch writing content ---
    const { data: writingRow } = await supabase
      .from("writing_content")
      .select("content")
      .eq("project_id", project_id)
      .single();

    const writingContent = writingRow?.content ?? "";

    // --- 2a. Fetch creative data for creative template projects ---
    let creativeDataSection = "";
    if (project.template === "creative") {
      const { data: creativeRows } = await supabase
        .from("project_creative_data")
        .select("tool_type, data")
        .eq("project_id", project_id);
      if (creativeRows && creativeRows.length > 0) {
        creativeDataSection = formatCreativeDataForSummary(creativeRows as any);
      }
    }

    // --- 2b. Fetch existing summary ---
    const { data: summaryRow } = await supabase
      .from("writing_summary_log")
      .select("id, summary_text")
      .eq("project_id", project_id)
      .single();

    const existingSummary = summaryRow?.summary_text ?? null;

    // --- 3. Fetch recent chat messages (last 20, cross-thread) ---
    const { data: projectThreads } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("project_id", project_id);

    const threadIds = (projectThreads ?? []).map((t: { id: string }) => t.id);

    const { data: recentMessages } = threadIds.length > 0
      ? await supabase
          .from("chat_messages")
          .select("role, content")
          .in("thread_id", threadIds)
          .order("created_at", { ascending: false })
          .limit(50)
      : { data: [] };

    const recentChat = (recentMessages ?? []).reverse();

    // --- 4. LLM Call #1: Writing Summary (non-streamed) ---
    const summaryMessages = buildSummaryPrompt(
      writingContent,
      existingSummary,
      selected_text,
      instruction,
      source_module,
      projectLanguage,
      creativeDataSection,
    );

    const summaryResult = await callChatModel(chatModel, summaryMessages, summaryMaxTokens, temperature, thinking, effort, mistralEffort);
    const summaryText = summaryResult.text.trim();

    // --- 5. Determine summary update ---
    let updatedSummary: string;
    let summaryUpdate: string;

    if (summaryText === "No update needed." && existingSummary) {
      updatedSummary = existingSummary;
      summaryUpdate = "No update needed.";
    } else if (existingSummary && summaryText.startsWith("Additionally")) {
      updatedSummary = existingSummary + "\n" + summaryText;
      summaryUpdate = summaryText;
    } else {
      updatedSummary = summaryText;
      summaryUpdate = summaryText;
    }

    // --- 6. Build LLM Call #2 prompt ---
    const tutorMode = project.tutor_mode ?? false;
    const conciseMode = body.concise_mode ?? false;

    const CLASSIC_MODE_SYSTEM_PROMPT = `You are an AI assistant working in the Sylou environment, designed to help users create high-quality work through thoughtful human-AI collaboration.

Your role is to assist the user with their writing project by providing helpful feedback, generating ideas, answering questions, and supporting their creative or analytical process. You should be knowledgeable, supportive, and responsive to the user's needs.

# GUIDELINES:

- Provide substantive, thoughtful responses that genuinely help the user
- When asked for opinions or feedback, be honest and constructive
- Adapt your communication style to the user's needs and the project type
- If the user asks you to write content, provide high-quality drafts that the user can then review, edit, and make their own
- Support the user's learning and thinking process, not just their output
- Be aware that your conversation is part of a collaborative writing project that will be assessed for the balance of human and AI contributions

# CONTEXT AWARENESS:

- If the user asks about specific parts of their writing without providing the text, suggest they use the "Interact with AI" button when selecting text in the editor for the most accurate and context-aware response.
- When responding to Ask or Propose requests from the text selection window, you will receive a writing summary providing relevant context about the user's work. Use this context to give informed, specific feedback rather than generic advice.
- For projects using the Creative template, you may also receive context from creative writing tools (character diagrams, timelines, world-building notes). Use this structured data to ensure consistency in your suggestions.

# TRANSPARENCY:

- Your interactions with the user are recorded and may be analyzed as part of the FLOW assessment of this project
- Be genuine in your assistance — do not try to influence the FLOW assessment by changing your behavior`;

    const TUTOR_MODE_SYSTEM_PROMPT = `You are an AI assistant working in the Sylou environment, operating in Tutor Mode. You are a patient teaching assistant who should prioritize learning over giving direct answers, on a reasonable basis.

You may provide generic information and share facts that are helpful for the user to complete their intellectual work, but you should avoid producing said intellectual work yourself. Before responding in a way that produces intellectual work (instead of just sharing information or data), ask the user one or two reflective questions to incite the user to work by himself and to guide them.

Guide the user to think, reflect, and structure ideas on their own.

In doing so, consider the following behavior with regards to the four FLOW pillars showcasing the necessary steps to complete an intellectual work:

- F - Find (Research & Critical Thinking): You may provide facts and generic information that are helpful for the user to complete their intellectual work, while giving tips on how to find other relevant and useful information, and reminding to complete fact-checking.
- L - Lead (Ideas & Opinions): Encourage the user to think and reflect on their own ideas and opinions, and to share them with you. You may provide tips on how to develop and refine their ideas and opinions, and provide feedback on said ideas and opinions if requested.
- O - Organize (Structure & Argumentation): You should avoid providing directly a full outline or structure of the work, but you may provide guidance to help the user achieve this goal and to help develop the structure of their argumentation.
- W - Write (Writing & Text Production): You should avoid providing directly a full draft of the final / intellectual work, but you may provide tips, guidance, or orthographic/grammatical corrections.

Do not hallucinate facts. Encourage reasoning, explanation, and personal input.

# CONTEXT AWARENESS:

- If the user asks about specific parts of their writing without providing the text, suggest they select the text and use the "Ask" button for context-aware guidance.
- In Tutor Mode, only "Fix grammar", "Translate", and "Ask" are available from the text selection window. This is intentional — the user should write and revise independently.
- When responding to Ask requests from the text selection window, use the writing summary to give targeted questions and guidance rather than answers.
- For Creative template projects, use character diagrams and timelines to ask probing questions about consistency and character development.

# TRANSPARENCY:

- Your interactions are recorded and analyzed as part of the FLOW assessment.
- Tutor Mode is designed to help the user achieve higher FLOW scores by developing genuine ownership of their work.`;

    const CONCISE_MODE_MODIFIER = `CONCISE MODE ACTIVE: Keep your responses brief and focused.

- Use short paragraphs (2-3 sentences maximum)
- Get to the point quickly — no lengthy preambles
- Use bullet points only when listing specific items
- If the user needs more detail, they will ask
- In tutor mode: ask 1-2 focused questions rather than multiple
- Do not give examples unless specifically requested
- Aim for responses under 150 words unless the topic requires more`;

    let systemPrompt = tutorMode
      ? TUTOR_MODE_SYSTEM_PROMPT
      : CLASSIC_MODE_SYSTEM_PROMPT;

    // --- Append template-specific context ---
    const TEMPLATE_PROMPTS: Record<string, string> = {
      academic: "This is an academic writing project. The user may be working on essays, papers, or research work. Importance of using reputable or reliable information and sources.",
      creative: "This is a creative writing project. The user may be working on fiction, poetry, or narrative work.",
      professional: "This is a professional writing project. The user may be working on business documents, reports, or communications. Focus on clarity, precision, and professional tone.",
    };
    const templateAddition = TEMPLATE_PROMPTS[project?.template ?? ""];
    if (templateAddition) {
      systemPrompt += `\n\n# PROJECT TEMPLATE\n\n${templateAddition}`;
    }

    if (conciseMode) {
      systemPrompt += "\n\n" + CONCISE_MODE_MODIFIER;
    }

    // --- Fetch imported documents (for index + favourite full-text injection) ---
    const adminClient = getAdminClient();

    const { data: importedDocs } = await adminClient
      .from("imported_documents")
      .select("id, file_name, summary, extracted_text, is_favourite")
      .eq("project_id", project_id);

    const allDocs = importedDocs ?? [];
    const favourites = allDocs.filter((d: any) => d.is_favourite && d.extracted_text);
    const nonFavourites = allDocs.filter((d: any) => !d.is_favourite);
    const hasNonFavDocs = nonFavourites.length > 0;
    const hasDocuments = hasNonFavDocs; // controls doc tool registration

    // Append document index to system prompt for NON-favourites only
    if (hasNonFavDocs) {
      let docIndex = `\n\n# IMPORTED DOCUMENTS\n\nThe user has imported the following reference documents into this project. You can see their titles and summaries below. If you need the full text of any document to answer the user's question or fulfill their request, use the read_imported_document tool. Only retrieve documents that are directly relevant.\n\n`;
      for (const doc of nonFavourites) {
        docIndex += `- Document: "${doc.file_name}" (ID: ${doc.id})\n  Summary: ${doc.summary ?? "No summary available"}\n\n`;
      }
      systemPrompt += docIndex;
    }

    // Append full text of FAVOURITE documents — always available, no tool call needed
    if (favourites.length > 0) {
      let favBlock = `\n\n# REFERENCE DOCUMENTS (ALWAYS AVAILABLE)\n\nThe following documents have been provided by the user as key reference material. Their full content is included below. Use them to inform your responses without needing to call the read_imported_document tool.\n\n`;
      for (const doc of favourites) {
        favBlock += `=== ${doc.file_name} ===\n\n${doc.extracted_text}\n\n`;
      }
      if (hasNonFavDocs) {
        favBlock += `Note: You also have access to additional imported documents via the read_imported_document tool. Prefer the reference documents above when they contain relevant information; use the tool for the others.\n\n`;
      }
      systemPrompt += favBlock;
    }

    // Gate web search on both the user toggle AND BRAVE_SEARCH_API_KEY presence
    // (mirrors chat/). Without a server-side key the tool can't work, so don't
    // register it or advertise it to the model.
    const braveConfigured = !!Deno.env.get("BRAVE_SEARCH_API_KEY");
    const webSearchActive = webSearchEnabled && braveConfigured;

    // Append web search instructions to system prompt
    if (webSearchActive) {
      systemPrompt += `\n\n# WEB SEARCH

You have access to a web_search tool. Use it according to these rules:

Always search when the user asks about: current events, recent news and developments, anything time-sensitive (prices, scores, weather, standings, elections), specific claims or facts you're not fully confident about, people's current roles or status, or any question where being up-to-date matters.

Never search for: simple conversational messages (greetings, thanks, acknowledgments), questions about well-established facts, concepts, or definitions, requests for creative writing or brainstorming, follow-up questions where the answer is already in the conversation history, or opinions and advice based on general knowledge.

When in doubt, prefer searching - an unnecessary search is better than an outdated answer.

When citing information from web search results, always include the source URL inline in your response text (e.g. "According to [Source Title](URL), ..."). This ensures the user can verify and revisit the sources later.`;
    }

    // conversation-memory: the ACTIVE thread's rolling summary (the recent
    // window above is project-wide; the memory is per-thread). Read via the
    // user-context client so RLS scopes it to the caller's own threads. It
    // renders next to RECENT CHAT HISTORY inside the same context container
    // that already carries the raw messages — identical relative privilege.
    const conversationMemory = await fetchConversationMemory(supabase, thread_id);

    const responseMessages = buildResponsePrompt(
      systemPrompt,
      updatedSummary,
      selected_text,
      instruction,
      source_module,
      recentChat,
      action_type,
      projectLanguage,
      conversationMemory?.summary_text ?? null,
    );

    // Track totals across all calls
    let totalInputChars = summaryResult.inputChars;
    let totalOutputChars = summaryResult.outputChars;
    const documentsReferenced: string[] = [];
    const webSearchesPerformed: string[] = [];

    // --- Build tools array ---
    const hasTools = hasDocuments || webSearchActive;
    // LLMTool[] since seam 2b: the shared builders are precisely typed, and
    // the previous Record<string, unknown>[] annotation can't hold them.
    // Type-level only — erased at compile time.
    const tools: LLMTool[] = [];
    if (hasDocuments) tools.push(buildDocumentTool());
    if (webSearchActive) tools.push(buildWebSearchTool());

    // All LLM calls (tool-bearing and not) go through callLLM, which handles
    // provider routing + body translation. normaliseResponse uniformly extracts
    // tool calls and the assistant message regardless of provider.

    // =========================================================
    // STREAMING PATH — LLM Call #2 with optional tool-use
    // =========================================================
    if (streamRequested) {
      console.log("[stream:context-prompt] entering streaming path, action_type:", action_type, "hasTools:", hasTools);

      const { sseEvent, createSSEResponse } = makeSSEHelpers(corsHeaders);

      // Helper: persist results after streaming completes
      async function persistResults(
        aiResponse: string,
        extraInputChars: number,
        extraOutputChars: number,
      ) {
        const finalInputChars = totalInputChars + extraInputChars;
        const finalOutputChars = totalOutputChars + extraOutputChars;
        const totalTokens = Math.ceil((finalInputChars + finalOutputChars) / 4);

        // Core writes (action row, chat messages, summary log) flip this and
        // the caller reports failure instead of success; secondary writes
        // (token_usage, billing RPC) are logged loudly but never fail the
        // exchange.
        let persistenceFailed = false;

        // Only Propose gets a ledger row: it carries the decision that the
        // pending-gated CONFIRM endpoint records, and feeds the FLOW outcome
        // statistics. Ask has no decision to record — its full exchange is
        // logged in the chat below, which is its canonical (and only) record.
        let actionRow: { id: string } | null = null;
        if (action_type !== "ask") {
          const { data: insertedAction, error: actionErr } = await adminClient
            .from("ai_editor_actions")
            .insert({
              project_id,
              action_type: "propose",
              selected_text_preview: sliceSafe(selected_text, 500),
              ai_response_preview: sliceSafe(aiResponse, 500),
              ai_response_full: aiResponse,
              proposed_summary: summaryUpdate,
              char_count_original: selected_text.length,
              char_count_result: aiResponse.length,
              outcome: "pending",
              instruction_text: selectedTextSource
                ? `${sliceSafe(instruction, 1000)} | Source: ${selectedTextSource}`
                : sliceSafe(instruction, 1000),
            })
            .select("id")
            .single();
          if (actionErr) {
            console.error("[context-prompt] ai_editor_actions insert failed:", JSON.stringify(actionErr));
            persistenceFailed = true;
          }
          actionRow = insertedAction;
        }

        const { error: usageErr } = await supabase.from("token_usage").insert({
          user_id: authedUser.id,
          project_id,
          function_name: "context-prompt",
          model_used: chatModel,
          input_tokens: Math.ceil(finalInputChars / 4),
          output_tokens: Math.ceil(finalOutputChars / 4),
        });
        if (usageErr) console.error("[context-prompt] token_usage insert failed:", JSON.stringify(usageErr));

        const { error: rpcErr } = await supabase.rpc("increment_tokens_used", {
          user_uuid: authedUser.id,
          amount: totalTokens,
        });
        if (rpcErr) console.error("[context-prompt] increment_tokens_used failed:", JSON.stringify(rpcErr));

        const budgetRemaining: number | null = authedProfile.monthly_token_budget === null ? null : authedProfile.monthly_token_budget - authedProfile.tokens_used_this_period - totalTokens;

        const insertedMessages: unknown[] = [];

        // Log the exchange at delivery for Ask AND Propose alike (deliberate
        // contract — TRANSPARENCY.md §5.1): the user reads the reply either
        // way, so it goes on the record here, server-side in the stream-first
        // flush (surviving dismissals, tab closes and disconnects). For
        // Propose, the CONFIRM endpoint afterwards records only the decision.
        {
          const isAsk = action_type === "ask";
          const sourceNote = selectedTextSource ? ` Source: ${selectedTextSource}.` : "";
          const userPromptContent = `[${isAsk ? "Ask" : "Propose"}] Selected: "${sliceSafe(selected_text, 200)}${selected_text.length > 200 ? "…" : ""}"${sourceNote}\n${isAsk ? "Question" : "Instruction"}: ${instruction}`;

          const { data: promptMsg, error: promptErr } = await adminClient.from("chat_messages").insert({
            thread_id,
            role: "user",
            content: userPromptContent,
            source_type: isAsk ? "ask_prompt" : "propose_prompt",
            flow_flag: "normal",
            concise_mode: conciseMode,
            tutor_mode: tutorMode,
          }).select().single();
          if (promptErr) {
            console.error("[context-prompt] prompt message insert failed:", JSON.stringify(promptErr));
            persistenceFailed = true;
          }
          if (promptMsg) insertedMessages.push(promptMsg);

          if (summaryUpdate !== "No update needed.") {
            // writing_summary intentionally omits concise_mode and tutor_mode (defaults to false):
            // the summary is produced by LLM #1 which never receives the CONCISE_MODE_MODIFIER
            // nor the tutor-mode system prompt.
            const { data: summaryMsg, error: summaryMsgErr } = await adminClient.from("chat_messages").insert({
              thread_id,
              role: "assistant",
              content: summaryUpdate,
              source_type: "writing_summary",
              flow_flag: "not_assessed",
            }).select().single();
            if (summaryMsgErr) {
              console.error("[context-prompt] summary message insert failed:", JSON.stringify(summaryMsgErr));
              persistenceFailed = true;
            }
            if (summaryMsg) insertedMessages.push(summaryMsg);
          }

          const responseRow: Record<string, unknown> = {
            thread_id,
            role: "assistant",
            content: aiResponse,
            source_type: isAsk ? "ask_response" : "propose_response",
            flow_flag: "normal",
            model_used: chatModel,
            concise_mode: conciseMode,
            tutor_mode: tutorMode,
          };
          if (documentsReferenced.length > 0) {
            responseRow.documents_referenced = documentsReferenced;
          }
          if (webSearchesPerformed.length > 0) {
            responseRow.web_searches_performed = webSearchesPerformed;
          }

          const { data: responseMsg, error: responseErr } = await adminClient.from("chat_messages").insert(responseRow).select().single();
          if (responseErr) {
            console.error("[context-prompt] response message insert failed:", JSON.stringify(responseErr));
            persistenceFailed = true;
          }
          if (responseMsg) insertedMessages.push(responseMsg);

          if (summaryUpdate !== "No update needed.") {
            if (summaryRow) {
              const { error: logErr } = await adminClient
                .from("writing_summary_log")
                .update({ summary_text: updatedSummary, last_updated_at: new Date().toISOString() })
                .eq("id", summaryRow.id);
              if (logErr) {
                console.error("[context-prompt] writing_summary_log update failed:", JSON.stringify(logErr));
                persistenceFailed = true;
              }
            } else {
              const { error: logErr } = await adminClient.from("writing_summary_log").insert({
                project_id,
                summary_text: updatedSummary,
              });
              if (logErr) {
                console.error("[context-prompt] writing_summary_log insert failed:", JSON.stringify(logErr));
                persistenceFailed = true;
              }
            }
          }
        }

        return { actionRow, budgetRemaining, insertedMessages, persistenceFailed };
      }

      // ── TWO-PASS FLOW when tools exist ──
      // Move entire Call #2a inside ReadableStream so phase events stream immediately
      if (hasTools) {
        console.log("[stream:context-prompt] tools available, two-pass flow (stream-first)");

        const readable = new ReadableStream({
          async start(controller) {
            try {
              // Emit initial phase so the client knows we're working
              controller.enqueue(sseEvent({ phase: "reviewing" }));

              // Call #2a: non-streamed with tools (provider-aware via callLLM)
              const call2aRes = await callLLM({
                model: chatModel,
                messages: responseMessages as any,
                max_tokens: contextMaxTokens,
                tools: tools as any,
                temperature,
                thinking,
                effort,
                mistral_effort: mistralEffort,
              });

              if (!call2aRes.ok) {
                const errText = await call2aRes.text();
                console.error("[stream:context-prompt] Call #2a error:", call2aRes.status, errText);
                controller.enqueue(sseEvent({ error: extractProviderError(providerFor(chatModel), call2aRes.status, errText) }));
                return;
              }

              const call2aData = await call2aRes.json();
              const norm2a = normaliseResponse(providerFor(chatModel), call2aData);
              const toolCalls = norm2a.toolCalls;
              const call2aContent = cleanLLMContent(norm2a.text);
              const call2aInputChars = responseMessages.reduce((s, m) => s + m.content.length, 0);
              totalInputChars += call2aInputChars;
              totalOutputChars += call2aContent.length;

              if (toolCalls.length === 0) {
                // No tool use — emit Call #2a text as rapid SSE tokens
                console.log("[stream:context-prompt] no tool use, emitting Call #2a directly");
                const responseText = call2aContent || "No response generated.";

                controller.enqueue(sseEvent({ phase: "responding" }));

                await replayTokenBurst(responseText, (chunk) => controller.enqueue(sseEvent({ token: chunk })));

                const { actionRow, budgetRemaining, insertedMessages, persistenceFailed } = await persistResults(responseText, 0, 0);

                if (persistenceFailed) {
                  controller.enqueue(sseEvent({ done: true, error: "Messages may not have been saved." }));
                } else {
                  controller.enqueue(sseEvent({
                    done: true,
                    ai_response: responseText,
                    summary_update: summaryUpdate,
                    action_id: actionRow?.id ?? null,
                    budget_remaining: budgetRemaining,
                    inserted_messages: insertedMessages,
                    ...(documentsReferenced.length > 0 ? { documents_referenced: documentsReferenced } : {}),
                    ...(webSearchesPerformed.length > 0 ? { web_searches_performed: webSearchesPerformed } : {}),
                  }));
                }
              } else {
                // ── Tool use detected ──
                console.log("[stream:context-prompt] tool use detected:", toolCalls.length, "calls");

                // Tool messages stay in OpenAI shape; toAnthropicBody in _llm.ts
                // translates `role:"tool"` and assistant `tool_calls` to Anthropic's
                // tool_result / tool_use content blocks transparently.
                const toolMessages: Array<Record<string, unknown>> = [
                  ...responseMessages,
                  norm2a.assistantMessage as unknown as Record<string, unknown>,
                ];

                for (const [tcIndex, tc] of toolCalls.entries()) {
                  if (tcIndex >= TOOL_CALL_LIMIT) {
                    toolMessages.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      content: "Not executed: per-turn tool-call limit reached. Ask again in a follow-up if still needed.",
                    });
                  } else if (tc.name === "read_imported_document") {
                    const docId = tc.arguments.document_id as string;
                    console.log("[stream:context-prompt] reading document:", docId);
                    documentsReferenced.push(docId);

                    try { controller.enqueue(sseEvent({ phase: "reading_documents" })); } catch { /* */ }

                    const { data: docData } = await adminClient
                      .from("imported_documents")
                      .select("extracted_text, file_name")
                      .eq("id", docId)
                      .eq("project_id", project_id)
                      .maybeSingle();

                    const toolResult = docData?.extracted_text
                      ? `Document "${docData.file_name}":\n\n${docData.extracted_text}`
                      : `Document not found in this project or text not yet extracted.`;

                    totalInputChars += toolResult.length;

                    toolMessages.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      content: toolResult,
                    });
                  } else if (tc.name === "web_search") {
                    const query = tc.arguments.query as string;
                    console.log("[stream:context-prompt] web search:", query);
                    webSearchesPerformed.push(query);

                    try { controller.enqueue(sseEvent({ phase: "searching_web" })); } catch { /* */ }

                    const results = await searchWeb(query);
                    const toolResult = formatWebSearchResults(query, results);
                    totalInputChars += toolResult.length;

                    toolMessages.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      content: toolResult,
                    });
                  } else {
                    toolMessages.push({
                      role: "tool",
                      tool_call_id: tc.id,
                      content: `Unknown tool "${tc.name}" — not executed.`,
                    });
                  }
                }

                // Call #2b: streaming with tool results (provider-aware via callLLM)
                console.log("[stream:context-prompt] starting Call #2b streaming");
                const call2bRes = await callLLM({
                  model: chatModel,
                  messages: toolMessages as any,
                  max_tokens: contextMaxTokens,
                  stream: true,
                  temperature,
                  thinking,
                  effort,
                  mistral_effort: mistralEffort,
                });

                if (!call2bRes.ok) {
                  const errText = await call2bRes.text();
                  console.error("[stream:context-prompt] Call #2b error:", call2bRes.status, errText);
                  controller.enqueue(sseEvent({ done: true, error: extractProviderError(providerFor(chatModel), call2bRes.status, errText) }));
                  return;
                }

                // Read Call #2b stream and forward tokens
                let fullResponse = await readProviderStream(call2bRes, providerFor(chatModel), {
                  onToken: (delta) => {
                    try { controller.enqueue(sseEvent({ token: delta })); } catch { /* client gone */ }
                  },
                });

                // Clean and persist
                fullResponse = cleanLLMContent(fullResponse);
                const aiResponse = fullResponse.trim() || "No response generated.";
                const { actionRow, budgetRemaining, insertedMessages, persistenceFailed } = await persistResults(aiResponse, 0, aiResponse.length);

                try {
                  if (persistenceFailed) {
                    controller.enqueue(sseEvent({ done: true, error: "Messages may not have been saved." }));
                  } else {
                    controller.enqueue(sseEvent({
                      done: true,
                      ai_response: aiResponse,
                      summary_update: summaryUpdate,
                      action_id: actionRow?.id ?? null,
                      budget_remaining: budgetRemaining,
                      inserted_messages: insertedMessages,
                      ...(documentsReferenced.length > 0 ? { documents_referenced: documentsReferenced } : {}),
                      ...(webSearchesPerformed.length > 0 ? { web_searches_performed: webSearchesPerformed } : {}),
                    }));
                  }
                } catch { /* client gone */ }
              }
            } catch (err) {
              console.error("[stream:context-prompt] error in tool-use path:", err);
              const msg = err instanceof Error && err.message ? sliceSafe(err.message, 200) : "AI service temporarily unavailable.";
              try { controller.enqueue(sseEvent({ done: true, error: msg })); } catch { /* */ }
            } finally {
              // conversation-memory: refresh in the tail, after `done` —
              // Ask/Propose exchanges land in the thread too, so this
              // function crosses the boundary as well. Non-fatal; no-ops
              // cheaply when fewer than the threshold are uncovered.
              await maybeRefreshConversationMemory({
                admin: adminClient,
                threadId: thread_id,
                model: chatModel,
                userId: authedUser.id,
                overBudget: authedProfile.monthly_token_budget !== null &&
                  authedProfile.tokens_used_this_period >= authedProfile.monthly_token_budget,
                logTag: "[context-prompt]",
              });
              controller.close();
            }
          },
        });

        return createSSEResponse(readable);
      }
      // ── NO TOOLS — streaming Call #2 using ReadableStream ──
      console.log("[stream:context-prompt] no tools, standard streaming");

      const llmRes = await callLLM({
        model: chatModel,
        messages: responseMessages as any,
        max_tokens: contextMaxTokens,
        stream: true,
        temperature,
        thinking,
        effort,
        mistral_effort: mistralEffort,
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        console.error("[stream:context-prompt] LLM API error:", llmRes.status, errText);
        return jsonResponse(
          { error: extractProviderError(providerFor(chatModel), llmRes.status, errText) },
          502
        );
      }

      const readable = new ReadableStream({
        async start(controller) {
          let fullResponse = "";

          try {
            controller.enqueue(sseEvent({ phase: "responding" }));

            fullResponse = await readProviderStream(llmRes, providerFor(chatModel), {
              onToken: (delta) => {
                try {
                  controller.enqueue(sseEvent({ token: delta }));
                } catch { /* client gone */ }
              },
            });

            console.log("[stream:context-prompt] LLM stream complete, persisting");
            fullResponse = cleanLLMContent(fullResponse);
            const aiResponse = fullResponse.trim() || "No response generated.";
            const extraInputChars = responseMessages.reduce((s, m) => s + m.content.length, 0);
            const { actionRow, budgetRemaining, insertedMessages, persistenceFailed } = await persistResults(aiResponse, extraInputChars, aiResponse.length);

            try {
              if (persistenceFailed) {
                controller.enqueue(sseEvent({ done: true, error: "Messages may not have been saved." }));
              } else {
                controller.enqueue(sseEvent({
                  done: true,
                  ai_response: aiResponse,
                  summary_update: summaryUpdate,
                  action_id: actionRow?.id ?? null,
                  budget_remaining: budgetRemaining,
                  inserted_messages: insertedMessages,
                }));
              }
            } catch { /* client gone */ }

            console.log("[stream:context-prompt] persistence complete");
          } catch (persistErr) {
            console.error("[stream:context-prompt] persistence error:", persistErr);
            try {
              controller.enqueue(sseEvent({ done: true, error: "Action may not have been saved." }));
            } catch { /* client gone */ }
          } finally {
            // conversation-memory: refresh in the tail (see tool-use path).
            await maybeRefreshConversationMemory({
              admin: adminClient,
              threadId: thread_id,
              model: chatModel,
              userId: authedUser.id,
              overBudget: authedProfile.monthly_token_budget !== null &&
                authedProfile.tokens_used_this_period >= authedProfile.monthly_token_budget,
              logTag: "[context-prompt]",
            });
            controller.close();
          }
        },
      });

      return createSSEResponse(readable);
    }

    // =========================================================
    // NON-STREAMING PATH — with optional two-pass document flow
    // =========================================================

    if (hasTools) {
      const call2aRes = await callLLM({
        model: chatModel,
        messages: responseMessages as any,
        max_tokens: contextMaxTokens,
        tools: tools as any,
        temperature,
        thinking,
        effort,
        mistral_effort: mistralEffort,
      });

      if (!call2aRes.ok) {
        const errText = await call2aRes.text();
        console.error("Call #2a error:", call2aRes.status, errText);
        throw new Error(extractProviderError(providerFor(chatModel), call2aRes.status, errText));
      }

      const call2aData = await call2aRes.json();
      const norm2a = normaliseResponse(providerFor(chatModel), call2aData);
      const toolCalls = norm2a.toolCalls;
      const call2aContent = cleanLLMContent(norm2a.text);
      totalInputChars += responseMessages.reduce((s, m) => s + m.content.length, 0);
      totalOutputChars += call2aContent.length;

      let aiResponse: string;

      if (toolCalls.length === 0) {
        aiResponse = call2aContent || "No response generated.";
      } else {
        const toolMessages: Array<Record<string, unknown>> = [
          ...responseMessages,
          norm2a.assistantMessage as unknown as Record<string, unknown>,
        ];

        for (const [tcIndex, tc] of toolCalls.entries()) {
          if (tcIndex >= TOOL_CALL_LIMIT) {
            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: "Not executed: per-turn tool-call limit reached. Ask again in a follow-up if still needed.",
            });
          } else if (tc.name === "read_imported_document") {
            const docId = tc.arguments.document_id as string;
            documentsReferenced.push(docId);
            const { data: docData } = await adminClient
              .from("imported_documents")
              .select("extracted_text, file_name")
              .eq("id", docId)
              .eq("project_id", project_id)
              .maybeSingle();

            const toolResult = docData?.extracted_text
              ? `Document "${docData.file_name}":\n\n${docData.extracted_text}`
              : `Document not found in this project or text not yet extracted.`;
            totalInputChars += toolResult.length;

            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResult,
            });
          } else if (tc.name === "web_search") {
            const query = tc.arguments.query as string;
            webSearchesPerformed.push(query);

            const results = await searchWeb(query);
            const toolResult = formatWebSearchResults(query, results);
            totalInputChars += toolResult.length;

            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: toolResult,
            });
          } else {
            toolMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: `Unknown tool "${tc.name}" — not executed.`,
            });
          }
        }

        const call2bResult = await callChatModel(chatModel, toolMessages as { role: string; content: string }[], contextMaxTokens, temperature, thinking, effort, mistralEffort);
        totalInputChars += call2bResult.inputChars;
        totalOutputChars += call2bResult.outputChars;
        aiResponse = call2bResult.text.trim() || "No response generated.";
      }

      const totalTokens = Math.ceil((totalInputChars + totalOutputChars) / 4);

      // Only Propose gets a ledger row (decision + outcome stats for FLOW);
      // Ask's canonical record is the chat itself — see persistResults.
      let actionRow: { id: string } | null = null;
      let persistenceFailed = false;
      if (action_type !== "ask") {
        const { data: insertedAction, error: actionErr } = await adminClient
          .from("ai_editor_actions")
          .insert({
            project_id,
            action_type: "propose",
            selected_text_preview: sliceSafe(selected_text, 500),
            ai_response_preview: sliceSafe(aiResponse, 500),
            ai_response_full: aiResponse,
            proposed_summary: summaryUpdate,
            char_count_original: selected_text.length,
            char_count_result: aiResponse.length,
            outcome: "pending",
            instruction_text: selectedTextSource
              ? `${sliceSafe(instruction, 1000)} | Source: ${selectedTextSource}`
              : sliceSafe(instruction, 1000),
          })
          .select("id")
          .single();
        if (actionErr) console.error("ai_editor_actions insert failed:", JSON.stringify(actionErr));
        persistenceFailed = !!actionErr;
        actionRow = insertedAction;
      }

      const { error: usageErr } = await supabase.from("token_usage").insert({
        user_id: user.id,
        project_id,
        function_name: "context-prompt",
        model_used: chatModel,
        input_tokens: Math.ceil(totalInputChars / 4),
        output_tokens: Math.ceil(totalOutputChars / 4),
      });
      if (usageErr) console.error("[context-prompt] token_usage insert failed:", JSON.stringify(usageErr));

      const { error: rpcErr } = await supabase.rpc("increment_tokens_used", { user_uuid: user.id, amount: totalTokens });
      if (rpcErr) console.error("[context-prompt] increment_tokens_used failed:", JSON.stringify(rpcErr));

      const budgetRemaining: number | null = profile.monthly_token_budget === null ? null : profile.monthly_token_budget - profile.tokens_used_this_period - totalTokens;

      const insertedMessages = [];
      // Delivery-time logging for Ask AND Propose alike — see persistResults.
      {
        const isAsk = action_type === "ask";
        const sourceNote = selectedTextSource ? ` Source: ${selectedTextSource}.` : "";
        const userPromptContent = `[${isAsk ? "Ask" : "Propose"}] Selected: "${sliceSafe(selected_text, 200)}${selected_text.length > 200 ? "…" : ""}"${sourceNote}\n${isAsk ? "Question" : "Instruction"}: ${instruction}`;

        const { data: promptMsg, error: promptErr } = await adminClient.from("chat_messages").insert({
          thread_id, role: "user", content: userPromptContent, source_type: isAsk ? "ask_prompt" : "propose_prompt", flow_flag: "normal", concise_mode: conciseMode, tutor_mode: tutorMode,
        }).select().single();
        if (promptErr) { console.error("[context-prompt] prompt message insert failed:", JSON.stringify(promptErr)); persistenceFailed = true; }
        if (promptMsg) insertedMessages.push(promptMsg);

        if (summaryUpdate !== "No update needed.") {
          // writing_summary intentionally omits concise_mode and tutor_mode (defaults to false):
          // the summary is produced by LLM #1 which never receives the CONCISE_MODE_MODIFIER
          // nor the tutor-mode system prompt.
          const { data: summaryMsg, error: summaryMsgErr } = await adminClient.from("chat_messages").insert({
            thread_id, role: "assistant", content: summaryUpdate, source_type: "writing_summary", flow_flag: "not_assessed",
          }).select().single();
          if (summaryMsgErr) { console.error("[context-prompt] summary message insert failed:", JSON.stringify(summaryMsgErr)); persistenceFailed = true; }
          if (summaryMsg) insertedMessages.push(summaryMsg);
        }

        const responseRow: Record<string, unknown> = {
          thread_id, role: "assistant", content: aiResponse, source_type: isAsk ? "ask_response" : "propose_response", flow_flag: "normal", model_used: chatModel, concise_mode: conciseMode, tutor_mode: tutorMode,
        };
        if (documentsReferenced.length > 0) responseRow.documents_referenced = documentsReferenced;
        if (webSearchesPerformed.length > 0) responseRow.web_searches_performed = webSearchesPerformed;

        const { data: responseMsg, error: responseErr } = await adminClient.from("chat_messages").insert(responseRow).select().single();
        if (responseErr) { console.error("[context-prompt] response message insert failed:", JSON.stringify(responseErr)); persistenceFailed = true; }
        if (responseMsg) insertedMessages.push(responseMsg);

        if (summaryUpdate !== "No update needed.") {
          if (summaryRow) {
            const { error: logErr } = await adminClient.from("writing_summary_log")
              .update({ summary_text: updatedSummary, last_updated_at: new Date().toISOString() })
              .eq("id", summaryRow.id);
            if (logErr) { console.error("[context-prompt] writing_summary_log update failed:", JSON.stringify(logErr)); persistenceFailed = true; }
          } else {
            const { error: logErr } = await adminClient.from("writing_summary_log").insert({ project_id, summary_text: updatedSummary });
            if (logErr) { console.error("[context-prompt] writing_summary_log insert failed:", JSON.stringify(logErr)); persistenceFailed = true; }
          }
        }
      }

      return jsonResponse({
        ai_response: aiResponse,
        summary_update: summaryUpdate,
        action_id: actionRow?.id ?? null,
        tokens_used: totalTokens,
        budget_remaining: budgetRemaining,
        inserted_messages: insertedMessages,
        ...(documentsReferenced.length > 0 ? { documents_referenced: documentsReferenced } : {}),
        ...(webSearchesPerformed.length > 0 ? { web_searches_performed: webSearchesPerformed } : {}),
        // Same contract as the streaming paths: failed core writes are
        // reported, never presented as success.
        ...(persistenceFailed ? { error: "Messages may not have been saved." } : {}),
      });
    }

    // ── NO TOOLS — original non-streaming path ──
    const responseResult = await callChatModel(chatModel, responseMessages, contextMaxTokens, temperature, thinking, effort, mistralEffort);
    const aiResponse = responseResult.text.trim();

    const finalInputChars = totalInputChars + responseResult.inputChars;
    const finalOutputChars = totalOutputChars + responseResult.outputChars;
    const totalTokens = Math.ceil((finalInputChars + finalOutputChars) / 4);

    // Only Propose gets a ledger row (decision + outcome stats for FLOW);
    // Ask's canonical record is the chat itself — see persistResults.
    let actionRow: { id: string } | null = null;
    let persistenceFailed = false;
    if (action_type !== "ask") {
      const { data: insertedAction, error: actionErr } = await adminClient
        .from("ai_editor_actions")
        .insert({
          project_id,
          action_type: "propose",
          selected_text_preview: sliceSafe(selected_text, 500),
          ai_response_preview: sliceSafe(aiResponse, 500),
          ai_response_full: aiResponse,
          proposed_summary: summaryUpdate,
          char_count_original: selected_text.length,
          char_count_result: aiResponse.length,
          outcome: "pending",
          instruction_text: selectedTextSource
            ? `${sliceSafe(instruction, 1000)} | Source: ${selectedTextSource}`
            : sliceSafe(instruction, 1000),
        })
        .select("id")
        .single();
      if (actionErr) console.error("ai_editor_actions insert failed:", JSON.stringify(actionErr));
      persistenceFailed = !!actionErr;
      actionRow = insertedAction;
    }

    const { error: usageErr } = await supabase.from("token_usage").insert({
      user_id: user.id,
      project_id,
      function_name: "context-prompt",
      model_used: chatModel,
      input_tokens: Math.ceil(finalInputChars / 4),
      output_tokens: Math.ceil(finalOutputChars / 4),
    });
    if (usageErr) console.error("[context-prompt] token_usage insert failed:", JSON.stringify(usageErr));

    const { error: rpcErr } = await supabase.rpc("increment_tokens_used", { user_uuid: user.id, amount: totalTokens });
    if (rpcErr) console.error("[context-prompt] increment_tokens_used failed:", JSON.stringify(rpcErr));

    const budgetRemaining: number | null = profile.monthly_token_budget === null ? null : profile.monthly_token_budget - profile.tokens_used_this_period - totalTokens;

    const insertedMessages = [];
    // Delivery-time logging for Ask AND Propose alike — see persistResults.
    {
      const isAsk = action_type === "ask";
      const sourceNote = selectedTextSource ? ` Source: ${selectedTextSource}.` : "";
      const userPromptContent = `[${isAsk ? "Ask" : "Propose"}] Selected: "${sliceSafe(selected_text, 200)}${selected_text.length > 200 ? "…" : ""}"${sourceNote}\n${isAsk ? "Question" : "Instruction"}: ${instruction}`;

      const { data: promptMsg, error: promptErr } = await adminClient.from("chat_messages").insert({
        thread_id, role: "user", content: userPromptContent, source_type: isAsk ? "ask_prompt" : "propose_prompt", flow_flag: "normal", concise_mode: conciseMode, tutor_mode: tutorMode,
      }).select().single();
      if (promptErr) { console.error("[context-prompt] prompt message insert failed:", JSON.stringify(promptErr)); persistenceFailed = true; }
      if (promptMsg) insertedMessages.push(promptMsg);

      if (summaryUpdate !== "No update needed.") {
        // writing_summary intentionally omits concise_mode and tutor_mode (defaults to false):
        // the summary is produced by LLM #1 which never receives the CONCISE_MODE_MODIFIER
        // nor the tutor-mode system prompt.
        const { data: summaryMsg, error: summaryMsgErr } = await adminClient.from("chat_messages").insert({
          thread_id, role: "assistant", content: summaryUpdate, source_type: "writing_summary", flow_flag: "not_assessed",
        }).select().single();
        if (summaryMsgErr) { console.error("[context-prompt] summary message insert failed:", JSON.stringify(summaryMsgErr)); persistenceFailed = true; }
        if (summaryMsg) insertedMessages.push(summaryMsg);
      }

      const { data: responseMsg, error: responseErr } = await adminClient.from("chat_messages").insert({
        thread_id, role: "assistant", content: aiResponse, source_type: isAsk ? "ask_response" : "propose_response", flow_flag: "normal", model_used: chatModel, concise_mode: conciseMode, tutor_mode: tutorMode,
      }).select().single();
      if (responseErr) { console.error("[context-prompt] response message insert failed:", JSON.stringify(responseErr)); persistenceFailed = true; }
      if (responseMsg) insertedMessages.push(responseMsg);

      if (summaryUpdate !== "No update needed.") {
        if (summaryRow) {
          const { error: logErr } = await adminClient.from("writing_summary_log")
            .update({ summary_text: updatedSummary, last_updated_at: new Date().toISOString() })
            .eq("id", summaryRow.id);
          if (logErr) { console.error("[context-prompt] writing_summary_log update failed:", JSON.stringify(logErr)); persistenceFailed = true; }
        } else {
          const { error: logErr } = await adminClient.from("writing_summary_log").insert({ project_id, summary_text: updatedSummary });
          if (logErr) { console.error("[context-prompt] writing_summary_log insert failed:", JSON.stringify(logErr)); persistenceFailed = true; }
        }
      }
    }

    return jsonResponse({
      ai_response: aiResponse,
      summary_update: summaryUpdate,
      action_id: actionRow?.id ?? null,
      tokens_used: totalTokens,
      budget_remaining: budgetRemaining,
      inserted_messages: insertedMessages,
      // Same contract as the streaming paths: failed core writes are
      // reported, never presented as success.
      ...(persistenceFailed ? { error: "Messages may not have been saved." } : {}),
    });
  } catch (err) {
    console.error("Context-prompt error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
