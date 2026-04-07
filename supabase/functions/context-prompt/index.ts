import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Service-role client for ai_editor_actions (bypasses RLS)
function getAdminClient() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceKey);
}

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

// ── helpers ──────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Clean LLM content that may be wrapped in Mistral's structured JSON format.
 */
function cleanLLMContent(content: unknown): string {
  if (!content) return "";
  // Already an array (Mistral structured format passed as object, not string)
  if (Array.isArray(content)) {
    return content
      .filter(b => b?.type === "text")
      .map(b => b.text ?? b.content ?? "")
      .join("");
  }
  if (typeof content !== "string") return String(content);
  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return content;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(b => b?.type === "text")) {
      return parsed.map(b => b.text ?? b.content ?? "").join("");
    }
  } catch { /* not JSON */ }
  return content;
}

/**
 * Extract the text delta from a streaming chunk, model-agnostic.
 */
function extractDeltaText(
  parsed: Record<string, unknown>,
  _provider: string
): string | null {
  const choices = parsed.choices as
    | Array<{ delta?: { content?: unknown } }>
    | undefined;
  const content = choices?.[0]?.delta?.content;
  if (content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text ?? "")
        .join("");
    }
    return String(content);
  }
  if (parsed.type === "content_block_delta") {
    const delta = parsed.delta as { text?: string } | undefined;
    if (delta?.text) return delta.text;
  }
  return null;
}

/**
 * Extract tool calls from a non-streaming LLM response.
 */
function extractToolCalls(
  response: Record<string, unknown>
): Array<{ id: string; name: string; arguments: Record<string, unknown> }> {
  const choices = response.choices as
    | Array<{
        message?: {
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>
    | undefined;

  const toolCalls = choices?.[0]?.message?.tool_calls;
  if (!toolCalls || toolCalls.length === 0) return [];

  return toolCalls.map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    arguments: JSON.parse(tc.function.arguments),
  }));
}

function buildDocumentTool() {
  return {
    type: "function",
    function: {
      name: "read_imported_document",
      description:
        "Retrieve the full text of an imported reference document. Use this when the user's question requires information from a specific imported document.",
      parameters: {
        type: "object",
        properties: {
          document_id: {
            type: "string",
            description: "The ID of the document to retrieve",
          },
        },
        required: ["document_id"],
      },
    },
  };
}

function buildWebSearchTool() {
  return {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web for current information. Use this when the user's question requires information not available in your training data or the project's imported documents. Returns the top results with titles, URLs, and text snippets.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
        },
        required: ["query"],
      },
    },
  };
}

async function searchWeb(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const apiKey = Deno.env.get("BRAVE_SEARCH_API_KEY");
  if (!apiKey) {
    console.error("[web_search] BRAVE_SEARCH_API_KEY not configured");
    return [];
  }

  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
      {
        headers: {
          "Accept": "application/json",
          "Accept-Encoding": "gzip",
          "X-Subscription-Token": apiKey,
        },
      }
    );

    if (!res.ok) {
      console.error("[web_search] Brave API error:", res.status, await res.text());
      return [];
    }

    const data = await res.json();
    const results = (data.web?.results ?? []).slice(0, 5);
    return results.map((r: { title?: string; url?: string; description?: string }) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.description ?? "",
    }));
  } catch (err) {
    console.error("[web_search] error:", err);
    return [];
  }
}

function formatWebSearchResults(query: string, results: { title: string; url: string; snippet: string }[]): string {
  if (results.length === 0) {
    return `Web search results for: "${query}"\n\nNo results found.`;
  }
  const formatted = results.map((r, i) =>
    `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`
  ).join("\n\n");
  return `Web search results for: "${query}"\n\n${formatted}`;
}

async function callMistral(
  apiKey: string,
  messages: { role: string; content: string }[],
  maxTokens = 2000,
): Promise<{ text: string; inputChars: number; outputChars: number }> {
  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "mistral-large-latest",
      messages,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Mistral API error:", res.status, errText);
    throw new Error("AI service temporarily unavailable");
  }

  const data = await res.json();
  const rawText = data.choices?.[0]?.message?.content ?? "";
  const text = cleanLLMContent(rawText);
  const inputChars = messages.reduce((s, m) => s + m.content.length, 0);
  return { text, inputChars, outputChars: text.length };
}

// ── Creative data formatting helpers ─────────────────────────────────────────

function stripHtmlDeno(html: string): string {
  if (!html) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  }
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

=== RECENT CHAT HISTORY ===
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

    // --- Token budget ---
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("tokens_used_this_period, monthly_token_budget")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    if (profile.tokens_used_this_period >= profile.monthly_token_budget) {
      return jsonResponse({ error: "Monthly token budget exceeded" }, 403);
    }

    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    if (!mistralKey) {
      return jsonResponse({ error: "Mistral API key not configured" }, 500);
    }

    // --- Parse body ---
    const body = await req.json();
    const { project_id, thread_id, action_type, selected_text, instruction, source_module } = body;
    const selectedTextSource: string | undefined = body.selected_text_source;
    const streamRequested: boolean = body.stream === true;
    const webSearchEnabled: boolean = body.web_search_enabled ?? false;

    // ── CONFIRM endpoint ────────────────────────────────────────────────
    if (body.confirm !== undefined) {
      const { confirm, action_id, summary_update, modified } = body;
      const adminClient = getAdminClient();

      if (action_id) {
        const outcome = !confirm ? "rejected" : modified ? "modified" : "accepted";
        const { error: updateErr } = await adminClient
          .from("ai_editor_actions")
          .update({ outcome })
          .eq("id", action_id);
        if (updateErr) console.error("ai_editor_actions outcome update failed:", JSON.stringify(updateErr));
      }

      if (confirm && thread_id) {
        let aiResponseContent = "";
        if (action_id) {
          const { data: actionRow, error: fetchErr } = await adminClient
            .from("ai_editor_actions")
            .select("ai_response_full")
            .eq("id", action_id)
            .maybeSingle();
          if (fetchErr) console.error("ai_editor_actions fetch failed:", JSON.stringify(fetchErr));
          aiResponseContent = actionRow?.ai_response_full ?? "";
        }
        if (!aiResponseContent && body.ai_response) {
          aiResponseContent = body.ai_response;
        }

        const documentsReferenced: string[] | undefined = body.documents_referenced;
        const webSearchesPerformed: string[] | undefined = body.web_searches_performed;

        const insertedMessages = [];

        const sourceNote = selectedTextSource ? ` Source: ${selectedTextSource}.` : "";
        const userPromptContent = `[Propose] Selected: "${(selected_text || "").slice(0, 200)}"${sourceNote}\nInstruction: ${instruction || ""}`;
        const { data: promptMsg } = await supabase.from("chat_messages").insert({
          thread_id,
          role: "user",
          content: userPromptContent,
          source_type: "propose_prompt",
          flow_flag: "normal",
        }).select().single();
        if (promptMsg) insertedMessages.push(promptMsg);

        if (summary_update && summary_update !== "No update needed.") {
          const { data: summaryMsg } = await supabase.from("chat_messages").insert({
            thread_id,
            role: "assistant",
            content: summary_update,
            source_type: "writing_summary",
            flow_flag: "not_assessed",
          }).select().single();
          if (summaryMsg) insertedMessages.push(summaryMsg);
        }

        const responseMsgRow: Record<string, unknown> = {
          thread_id,
          role: "assistant",
          content: aiResponseContent,
          source_type: "propose_response",
          flow_flag: "normal",
          model_used: "mistral-large-latest",
        };

        if (documentsReferenced && documentsReferenced.length > 0) {
          responseMsgRow.documents_referenced = documentsReferenced;
        }
        if (webSearchesPerformed && webSearchesPerformed.length > 0) {
          responseMsgRow.web_searches_performed = webSearchesPerformed;
        }

        const { data: responseMsg } = await supabase.from("chat_messages").insert(responseMsgRow).select().single();
        if (responseMsg) insertedMessages.push(responseMsg);

        if (summary_update && summary_update !== "No update needed.") {
          const { data: existingLog } = await supabase
            .from("writing_summary_log")
            .select("id, summary_text")
            .eq("project_id", project_id)
            .single();

          if (existingLog) {
            const newSummary = summary_update.startsWith("Additionally")
              ? existingLog.summary_text + "\n" + summary_update
              : summary_update;
            await supabase
              .from("writing_summary_log")
              .update({ summary_text: newSummary, last_updated_at: new Date().toISOString() })
              .eq("id", existingLog.id);
          } else {
            await supabase.from("writing_summary_log").insert({
              project_id,
              summary_text: summary_update,
            });
          }
        }

        return jsonResponse({ ok: true, inserted_messages: insertedMessages });
      }

      return jsonResponse({ ok: true, inserted_messages: [] });
    }

    // ── Main context-prompt flow ────────────────────────────────────────
    if (!project_id || !thread_id || !action_type || !selected_text || !instruction || !source_module) {
      return jsonResponse(
        { error: "project_id, thread_id, action_type, selected_text, instruction, and source_module are required" },
        400,
      );
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
          .limit(20)
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

    const summaryResult = await callMistral(mistralKey, summaryMessages, 1000);
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

    const CLASSIC_MODE_SYSTEM_PROMPT = `You are an AI assistant working in the Ethos environment, designed to help users create high-quality work through thoughtful human-AI collaboration.

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

    const TUTOR_MODE_SYSTEM_PROMPT = `You are an AI assistant working in the Ethos environment, operating in Tutor Mode. You are a patient teaching assistant who should prioritize learning over giving direct answers, on a reasonable basis.

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

    if (conciseMode) {
      systemPrompt += "\n\n" + CONCISE_MODE_MODIFIER;
    }

    // --- Fetch imported documents for document index ---
    const adminClient = getAdminClient();

    const { data: importedDocs } = await adminClient
      .from("imported_documents")
      .select("id, file_name, summary")
      .eq("project_id", project_id);

    const hasDocuments = importedDocs && importedDocs.length > 0;

    // Append document index to system prompt if documents exist
    if (hasDocuments) {
      let docIndex = `\n\n# IMPORTED DOCUMENTS\n\nThe user has imported the following reference documents into this project. You can see their titles and summaries below. If you need the full text of any document to answer the user's question or fulfill their request, use the read_imported_document tool. Only retrieve documents that are directly relevant.\n\n`;
      for (const doc of importedDocs) {
        docIndex += `- Document: "${doc.file_name}" (ID: ${doc.id})\n  Summary: ${doc.summary ?? "No summary available"}\n\n`;
      }
      systemPrompt += docIndex;
    }

    // Append web search instructions to system prompt
    if (webSearchEnabled) {
      const docsContext = hasDocuments
        ? " or in the imported documents"
        : "";
      systemPrompt += `\n\n# WEB SEARCH

You have access to a web_search tool. Use it according to these rules:

Always search when the user asks about: current events, recent news and developments, anything time-sensitive (prices, scores, weather, standings, elections), specific claims or facts you're not fully confident about, people's current roles or status, or any question where being up-to-date matters.

Never search for: simple conversational messages (greetings, thanks, acknowledgments), questions about well-established facts, concepts, or definitions, requests for creative writing or brainstorming, follow-up questions where the answer is already in the conversation history, or opinions and advice based on general knowledge.

When in doubt, prefer searching - an unnecessary search is better than an outdated answer.

When citing information from web search results, always include the source URL inline in your response text (e.g. "According to [Source Title](URL), ..."). This ensures the user can verify and revisit the sources later.`;
    }

    const responseMessages = buildResponsePrompt(
      systemPrompt,
      updatedSummary,
      selected_text,
      instruction,
      source_module,
      recentChat,
      action_type,
      projectLanguage,
    );

    // Track totals across all calls
    let totalInputChars = summaryResult.inputChars;
    let totalOutputChars = summaryResult.outputChars;
    const documentsReferenced: string[] = [];
    const webSearchesPerformed: string[] = [];

    // --- Build tools array ---
    const hasTools = hasDocuments || webSearchEnabled;
    const tools: Record<string, unknown>[] = [];
    if (hasDocuments) tools.push(buildDocumentTool());
    if (webSearchEnabled) tools.push(buildWebSearchTool());

    // =========================================================
    // STREAMING PATH — LLM Call #2 with optional tool-use
    // =========================================================
    if (streamRequested) {
      console.log("[stream:context-prompt] entering streaming path, action_type:", action_type, "hasTools:", hasTools);

      const encoder = new TextEncoder();

      function sseEvent(data: Record<string, unknown>): Uint8Array {
        return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
      }

      function createSSEResponse(readable: ReadableStream) {
        return new Response(readable, {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            Connection: "keep-alive",
          },
        });
      }

      // Helper: persist results after streaming completes
      async function persistResults(
        aiResponse: string,
        extraInputChars: number,
        extraOutputChars: number,
      ) {
        const finalInputChars = totalInputChars + extraInputChars;
        const finalOutputChars = totalOutputChars + extraOutputChars;
        const totalTokens = Math.ceil((finalInputChars + finalOutputChars) / 4);

        const { data: actionRow } = await adminClient
          .from("ai_editor_actions")
          .insert({
            project_id,
            action_type: action_type === "ask" ? "ask" : "propose",
            selected_text_preview: selected_text.slice(0, 500),
            ai_response_preview: aiResponse.slice(0, 500),
            ai_response_full: aiResponse,
            char_count_original: selected_text.length,
            char_count_result: aiResponse.length,
            outcome: action_type === "ask" ? "delivered" : "pending",
            instruction_text: selectedTextSource
              ? `${instruction.slice(0, 1000)} | Source: ${selectedTextSource}`
              : instruction.slice(0, 1000),
          })
          .select("id")
          .single();

        await supabase.from("token_usage").insert({
          user_id: user.id,
          project_id,
          function_name: "context-prompt",
          model_used: "mistral-large-latest",
          input_tokens: Math.ceil(finalInputChars / 4),
          output_tokens: Math.ceil(finalOutputChars / 4),
        });

        await supabase.rpc("increment_tokens_used", {
          user_uuid: user.id,
          amount: totalTokens,
        });

        const budgetRemaining = profile.monthly_token_budget - profile.tokens_used_this_period - totalTokens;

        const insertedMessages: unknown[] = [];

        if (action_type === "ask") {
          const sourceNote = selectedTextSource ? ` Source: ${selectedTextSource}.` : "";
          const userPromptContent = `[Ask] Selected: "${selected_text.slice(0, 200)}${selected_text.length > 200 ? "…" : ""}"${sourceNote}\nQuestion: ${instruction}`;

          const { data: promptMsg } = await supabase.from("chat_messages").insert({
            thread_id,
            role: "user",
            content: userPromptContent,
            source_type: "ask_prompt",
            flow_flag: "normal",
          }).select().single();
          if (promptMsg) insertedMessages.push(promptMsg);

          if (summaryUpdate !== "No update needed.") {
            const { data: summaryMsg } = await supabase.from("chat_messages").insert({
              thread_id,
              role: "assistant",
              content: summaryUpdate,
              source_type: "writing_summary",
              flow_flag: "not_assessed",
            }).select().single();
            if (summaryMsg) insertedMessages.push(summaryMsg);
          }

          const askResponseRow: Record<string, unknown> = {
            thread_id,
            role: "assistant",
            content: aiResponse,
            source_type: "ask_response",
            flow_flag: "normal",
            model_used: "mistral-large-latest",
          };
          if (documentsReferenced.length > 0) {
            askResponseRow.documents_referenced = documentsReferenced;
          }
          if (webSearchesPerformed.length > 0) {
            askResponseRow.web_searches_performed = webSearchesPerformed;
          }

          const { data: responseMsg } = await supabase.from("chat_messages").insert(askResponseRow).select().single();
          if (responseMsg) insertedMessages.push(responseMsg);

          if (summaryUpdate !== "No update needed.") {
            if (summaryRow) {
              await supabase
                .from("writing_summary_log")
                .update({ summary_text: updatedSummary, last_updated_at: new Date().toISOString() })
                .eq("id", summaryRow.id);
            } else {
              await supabase.from("writing_summary_log").insert({
                project_id,
                summary_text: updatedSummary,
              });
            }
          }
        }

        return { actionRow, budgetRemaining, insertedMessages };
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

              // Call #2a: non-streamed with tools (inside stream so response is already sent)
              const call2aBody = {
                model: "mistral-large-latest",
                messages: responseMessages,
                max_tokens: 2000,
                tools,
                tool_choice: "auto",
              };

              const call2aRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${mistralKey}`,
                },
                body: JSON.stringify(call2aBody),
              });

              if (!call2aRes.ok) {
                const errText = await call2aRes.text();
                console.error("[stream:context-prompt] Call #2a error:", call2aRes.status, errText);
                controller.enqueue(sseEvent({ error: "AI service temporarily unavailable. Please try again." }));
                return;
              }

              const call2aData = await call2aRes.json();
              const toolCalls = extractToolCalls(call2aData);
              const call2aContent = cleanLLMContent(call2aData.choices?.[0]?.message?.content ?? "");
              const call2aInputChars = responseMessages.reduce((s, m) => s + m.content.length, 0);
              totalInputChars += call2aInputChars;
              totalOutputChars += call2aContent.length;

              if (toolCalls.length === 0) {
                // No tool use — emit Call #2a text as rapid SSE tokens
                console.log("[stream:context-prompt] no tool use, emitting Call #2a directly");
                const responseText = call2aContent || "No response generated.";

                controller.enqueue(sseEvent({ phase: "responding" }));

                const chunkSize = 20;
                for (let i = 0; i < responseText.length; i += chunkSize) {
                  controller.enqueue(sseEvent({ token: responseText.slice(i, i + chunkSize) }));
                }

                const { actionRow, budgetRemaining, insertedMessages } = await persistResults(responseText, 0, 0);

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
              } else {
                // ── Tool use detected ──
                console.log("[stream:context-prompt] tool use detected:", toolCalls.length, "calls");

                const toolMessages: Array<Record<string, unknown>> = [
                  ...responseMessages,
                  call2aData.choices[0].message,
                ];

                for (const tc of toolCalls.slice(0, 5)) {
                  if (tc.name === "read_imported_document") {
                    const docId = tc.arguments.document_id as string;
                    console.log("[stream:context-prompt] reading document:", docId);
                    documentsReferenced.push(docId);

                    try { controller.enqueue(sseEvent({ phase: "reading_documents" })); } catch { /* */ }

                    const { data: docData } = await adminClient
                      .from("imported_documents")
                      .select("extracted_text, file_name")
                      .eq("id", docId)
                      .single();

                    const toolResult = docData?.extracted_text
                      ? `Document "${docData.file_name}":\n\n${docData.extracted_text}`
                      : `Document not found or text not yet extracted.`;

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
                  }
                }

                // Call #2b: streaming with tool results
                console.log("[stream:context-prompt] starting Call #2b streaming");
                const call2bRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${mistralKey}`,
                  },
                  body: JSON.stringify({
                    model: "mistral-large-latest",
                    messages: toolMessages,
                    max_tokens: 2000,
                    stream: true,
                  }),
                });

                if (!call2bRes.ok) {
                  const errText = await call2bRes.text();
                  console.error("[stream:context-prompt] Call #2b error:", call2bRes.status, errText);
                  controller.enqueue(sseEvent({ done: true, error: "AI service temporarily unavailable." }));
                  return;
                }

                // Read Call #2b stream and forward tokens
                let fullResponse = "";
                const decoder = new TextDecoder();
                let sseBuffer = "";
                const reader = call2bRes.body!.getReader();

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;

                  sseBuffer += decoder.decode(value, { stream: true });
                  const lines = sseBuffer.split("\n");
                  sseBuffer = lines.pop() ?? "";

                  for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed || !trimmed.startsWith("data:")) continue;
                    const payload = trimmed.slice(5).trim();
                    if (payload === "[DONE]") continue;

                    try {
                      const parsed = JSON.parse(payload);
                      const delta = extractDeltaText(parsed, "mistral");
                      if (delta) {
                        fullResponse += delta;
                        try { controller.enqueue(sseEvent({ token: delta })); } catch { /* client gone */ }
                      }
                    } catch { /* skip malformed */ }
                  }
                }

                // Clean and persist
                fullResponse = cleanLLMContent(fullResponse);
                const aiResponse = fullResponse.trim() || "No response generated.";
                const { actionRow, budgetRemaining, insertedMessages } = await persistResults(aiResponse, 0, aiResponse.length);

                try {
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
                } catch { /* client gone */ }
              }
            } catch (err) {
              console.error("[stream:context-prompt] error in tool-use path:", err);
              try { controller.enqueue(sseEvent({ done: true, error: "AI service temporarily unavailable." })); } catch { /* */ }
            } finally {
              controller.close();
            }
          },
        });

        return createSSEResponse(readable);
      }
      // ── NO TOOLS — streaming Call #2 using ReadableStream ──
      console.log("[stream:context-prompt] no tools, standard streaming");

      const llmRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mistralKey}`,
        },
        body: JSON.stringify({
          model: "mistral-large-latest",
          messages: responseMessages,
          max_tokens: 2000,
          stream: true,
        }),
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        console.error("[stream:context-prompt] Mistral API error:", llmRes.status, errText);
        return jsonResponse(
          { error: "AI service temporarily unavailable. Please try again." },
          502
        );
      }

      const readable = new ReadableStream({
        async start(controller) {
          let fullResponse = "";
          const decoder = new TextDecoder();
          let sseBuffer = "";

          try {
            controller.enqueue(sseEvent({ phase: "responding" }));

            const reader = llmRes.body!.getReader();

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              sseBuffer += decoder.decode(value, { stream: true });
              const lines = sseBuffer.split("\n");
              sseBuffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (payload === "[DONE]") continue;

                try {
                  const parsed = JSON.parse(payload);
                  const delta = extractDeltaText(parsed, "mistral");
                  if (delta) {
                    fullResponse += delta;
                    try {
                      controller.enqueue(sseEvent({ token: delta }));
                    } catch { /* client gone */ }
                  }
                } catch {
                  // skip malformed chunk
                }
              }
            }

            console.log("[stream:context-prompt] LLM stream complete, persisting");
            fullResponse = cleanLLMContent(fullResponse);
            const aiResponse = fullResponse.trim() || "No response generated.";
            const extraInputChars = responseMessages.reduce((s, m) => s + m.content.length, 0);
            const { actionRow, budgetRemaining, insertedMessages } = await persistResults(aiResponse, extraInputChars, aiResponse.length);

            try {
              controller.enqueue(sseEvent({
                done: true,
                ai_response: aiResponse,
                summary_update: summaryUpdate,
                action_id: actionRow?.id ?? null,
                budget_remaining: budgetRemaining,
                inserted_messages: insertedMessages,
              }));
            } catch { /* client gone */ }

            console.log("[stream:context-prompt] persistence complete");
          } catch (persistErr) {
            console.error("[stream:context-prompt] persistence error:", persistErr);
            try {
              controller.enqueue(sseEvent({ done: true, error: "Action may not have been saved." }));
            } catch { /* client gone */ }
          } finally {
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
      const call2aRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mistralKey}`,
        },
        body: JSON.stringify({
          model: "mistral-large-latest",
          messages: responseMessages,
          max_tokens: 2000,
          tools,
          tool_choice: "auto",
        }),
      });

      if (!call2aRes.ok) {
        const errText = await call2aRes.text();
        console.error("Call #2a error:", call2aRes.status, errText);
        throw new Error("AI service temporarily unavailable");
      }

      const call2aData = await call2aRes.json();
      const toolCalls = extractToolCalls(call2aData);
      const call2aContent = cleanLLMContent(call2aData.choices?.[0]?.message?.content ?? "");
      totalInputChars += responseMessages.reduce((s, m) => s + m.content.length, 0);
      totalOutputChars += call2aContent.length;

      let aiResponse: string;

      if (toolCalls.length === 0) {
        aiResponse = call2aContent || "No response generated.";
      } else {
        const toolMessages: Array<Record<string, unknown>> = [
          ...responseMessages,
          call2aData.choices[0].message,
        ];

        for (const tc of toolCalls.slice(0, 5)) {
          if (tc.name === "read_imported_document") {
            const docId = tc.arguments.document_id as string;
            documentsReferenced.push(docId);
            const { data: docData } = await adminClient
              .from("imported_documents")
              .select("extracted_text, file_name")
              .eq("id", docId)
              .single();

            const toolResult = docData?.extracted_text
              ? `Document "${docData.file_name}":\n\n${docData.extracted_text}`
              : `Document not found or text not yet extracted.`;
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
          }
        }

        const call2bResult = await callMistral(mistralKey, toolMessages as { role: string; content: string }[], 2000);
        totalInputChars += call2bResult.inputChars;
        totalOutputChars += call2bResult.outputChars;
        aiResponse = call2bResult.text.trim() || "No response generated.";
      }

      const totalTokens = Math.ceil((totalInputChars + totalOutputChars) / 4);

      const { data: actionRow, error: actionErr } = await adminClient
        .from("ai_editor_actions")
        .insert({
          project_id,
          action_type: action_type === "ask" ? "ask" : "propose",
          selected_text_preview: selected_text.slice(0, 500),
          ai_response_preview: aiResponse.slice(0, 500),
          ai_response_full: aiResponse,
          char_count_original: selected_text.length,
          char_count_result: aiResponse.length,
          outcome: action_type === "ask" ? "delivered" : "pending",
          instruction_text: selectedTextSource
            ? `${instruction.slice(0, 1000)} | Source: ${selectedTextSource}`
            : instruction.slice(0, 1000),
        })
        .select("id")
        .single();

      if (actionErr) console.error("ai_editor_actions insert failed:", JSON.stringify(actionErr));

      await supabase.from("token_usage").insert({
        user_id: user.id,
        project_id,
        function_name: "context-prompt",
        model_used: "mistral-large-latest",
        input_tokens: Math.ceil(totalInputChars / 4),
        output_tokens: Math.ceil(totalOutputChars / 4),
      });

      await supabase.rpc("increment_tokens_used", { user_uuid: user.id, amount: totalTokens });

      const budgetRemaining = profile.monthly_token_budget - profile.tokens_used_this_period - totalTokens;

      const insertedMessages = [];
      if (action_type === "ask") {
        const sourceNote = selectedTextSource ? ` Source: ${selectedTextSource}.` : "";
        const userPromptContent = `[Ask] Selected: "${selected_text.slice(0, 200)}${selected_text.length > 200 ? "…" : ""}"${sourceNote}\nQuestion: ${instruction}`;

        const { data: promptMsg } = await supabase.from("chat_messages").insert({
          thread_id, role: "user", content: userPromptContent, source_type: "ask_prompt", flow_flag: "normal",
        }).select().single();
        if (promptMsg) insertedMessages.push(promptMsg);

        if (summaryUpdate !== "No update needed.") {
          const { data: summaryMsg } = await supabase.from("chat_messages").insert({
            thread_id, role: "assistant", content: summaryUpdate, source_type: "writing_summary", flow_flag: "not_assessed",
          }).select().single();
          if (summaryMsg) insertedMessages.push(summaryMsg);
        }

        const askResponseRow: Record<string, unknown> = {
          thread_id, role: "assistant", content: aiResponse, source_type: "ask_response", flow_flag: "normal", model_used: "mistral-large-latest",
        };
        if (documentsReferenced.length > 0) askResponseRow.documents_referenced = documentsReferenced;
        if (webSearchesPerformed.length > 0) askResponseRow.web_searches_performed = webSearchesPerformed;

        const { data: responseMsg } = await supabase.from("chat_messages").insert(askResponseRow).select().single();
        if (responseMsg) insertedMessages.push(responseMsg);

        if (summaryUpdate !== "No update needed.") {
          if (summaryRow) {
            await supabase.from("writing_summary_log")
              .update({ summary_text: updatedSummary, last_updated_at: new Date().toISOString() })
              .eq("id", summaryRow.id);
          } else {
            await supabase.from("writing_summary_log").insert({ project_id, summary_text: updatedSummary });
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
      });
    }

    // ── NO TOOLS — original non-streaming path ──
    const responseResult = await callMistral(mistralKey, responseMessages, 2000);
    const aiResponse = responseResult.text.trim();

    const finalInputChars = totalInputChars + responseResult.inputChars;
    const finalOutputChars = totalOutputChars + responseResult.outputChars;
    const totalTokens = Math.ceil((finalInputChars + finalOutputChars) / 4);

    const { data: actionRow, error: actionErr } = await adminClient
      .from("ai_editor_actions")
      .insert({
        project_id,
        action_type: action_type === "ask" ? "ask" : "propose",
        selected_text_preview: selected_text.slice(0, 500),
        ai_response_preview: aiResponse.slice(0, 500),
        ai_response_full: aiResponse,
        char_count_original: selected_text.length,
        char_count_result: aiResponse.length,
        outcome: action_type === "ask" ? "delivered" : "pending",
        instruction_text: selectedTextSource
          ? `${instruction.slice(0, 1000)} | Source: ${selectedTextSource}`
          : instruction.slice(0, 1000),
      })
      .select("id")
      .single();

    if (actionErr) console.error("ai_editor_actions insert failed:", JSON.stringify(actionErr));

    await supabase.from("token_usage").insert({
      user_id: user.id,
      project_id,
      function_name: "context-prompt",
      model_used: "mistral-large-latest",
      input_tokens: Math.ceil(finalInputChars / 4),
      output_tokens: Math.ceil(finalOutputChars / 4),
    });

    await supabase.rpc("increment_tokens_used", { user_uuid: user.id, amount: totalTokens });

    const budgetRemaining = profile.monthly_token_budget - profile.tokens_used_this_period - totalTokens;

    const insertedMessages = [];
    if (action_type === "ask") {
      const sourceNote = selectedTextSource ? ` Source: ${selectedTextSource}.` : "";
      const userPromptContent = `[Ask] Selected: "${selected_text.slice(0, 200)}${selected_text.length > 200 ? "…" : ""}"${sourceNote}\nQuestion: ${instruction}`;

      const { data: promptMsg } = await supabase.from("chat_messages").insert({
        thread_id, role: "user", content: userPromptContent, source_type: "ask_prompt", flow_flag: "normal",
      }).select().single();
      if (promptMsg) insertedMessages.push(promptMsg);

      if (summaryUpdate !== "No update needed.") {
        const { data: summaryMsg } = await supabase.from("chat_messages").insert({
          thread_id, role: "assistant", content: summaryUpdate, source_type: "writing_summary", flow_flag: "not_assessed",
        }).select().single();
        if (summaryMsg) insertedMessages.push(summaryMsg);
      }

      const { data: responseMsg } = await supabase.from("chat_messages").insert({
        thread_id, role: "assistant", content: aiResponse, source_type: "ask_response", flow_flag: "normal", model_used: "mistral-large-latest",
      }).select().single();
      if (responseMsg) insertedMessages.push(responseMsg);

      if (summaryUpdate !== "No update needed.") {
        if (summaryRow) {
          await supabase.from("writing_summary_log")
            .update({ summary_text: updatedSummary, last_updated_at: new Date().toISOString() })
            .eq("id", summaryRow.id);
        } else {
          await supabase.from("writing_summary_log").insert({ project_id, summary_text: updatedSummary });
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
    });
  } catch (err) {
    console.error("Context-prompt error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
