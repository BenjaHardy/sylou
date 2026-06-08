import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, providerFor, normaliseResponse, extractProviderError } from "../_shared/_llm.ts";
import { CHAT_TEMPERATURE, resolveTemperature } from "../_shared/_temperatures.ts";

// Budget helper. Intentionally duplicated across the four edge functions
// (chat, context-prompt, editor-action, analysis) — Supabase edge function
// isolation prevents importing a shared module without a build step.
// A NULL monthly_token_budget means "no limit" (operator hasn't set one).
function isOverBudget(profile: {
  monthly_token_budget: number | null;
  tokens_used_this_period: number;
}): boolean {
  return (
    profile.monthly_token_budget !== null &&
    profile.tokens_used_this_period >= profile.monthly_token_budget
  );
}


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
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

    // --- Token budget + preferred model ---
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("tokens_used_this_period, monthly_token_budget, preferred_chat_model")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    if (isOverBudget(profile)) {
      return jsonResponse({ error: "Monthly token budget exceeded" }, 403);
    }

    // --- Parse body ---
    const body = await req.json();
    const threadId: string = body.thread_id;
    const message: string = body.message;
    const conciseMode: boolean = body.concise_mode ?? false;
    const streamRequested: boolean = body.stream === true;
    const webSearchEnabled: boolean = body.web_search_enabled ?? false;
    const requestedModel: string | undefined = body.model;
    const chatModel: string =
      requestedModel || profile.preferred_chat_model || "mistral-large-latest";
    const temperature = resolveTemperature(CHAT_TEMPERATURE, chatModel);


    if (!threadId || !message) {
      return jsonResponse({ error: "thread_id and message are required" }, 400);
    }

    // --- Verify thread ownership (RLS handles this) ---
    const { data: thread, error: threadErr } = await supabase
      .from("chat_threads")
      .select("id, project_id")
      .eq("id", threadId)
      .single();

    if (threadErr || !thread) {
      return jsonResponse({ error: "Thread not found or not owned by user" }, 404);
    }

    // --- Get project settings ---
    const { data: project } = await supabase
      .from("projects")
      .select("tutor_mode, template")
      .eq("id", thread.project_id)
      .single();

    const tutorMode = project?.tutor_mode ?? false;

    // --- Build system prompt ---
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: importedDocs } = await adminSupabase
      .from("imported_documents")
      .select("id, file_name, summary, extracted_text, is_favourite")
      .eq("project_id", thread.project_id);

    const allDocs = importedDocs ?? [];
    const favourites = allDocs.filter((d: any) => d.is_favourite && d.extracted_text);
    const nonFavourites = allDocs.filter((d: any) => !d.is_favourite);
    const hasNonFavDocs = nonFavourites.length > 0;
    const hasDocuments = hasNonFavDocs; // controls doc tool registration / index block

    // Append document index to system prompt for NON-favourites only
    if (hasNonFavDocs) {
      let docIndex = `\n\n# IMPORTED DOCUMENTS\n\nThe user has imported the following reference documents into this project. You can see their titles and summaries below. If you need the full text of any document to answer the user's question, use the read_imported_document tool. Only retrieve documents that are directly relevant to the user's query.\n\n`;
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

    // Gate web search on both user toggle AND BRAVE_SEARCH_API_KEY presence.
    // If unconfigured, never advertise the capability to the LLM — an empty
    // result set reads as "the web has nothing" rather than "not configured".
    const braveConfigured = !!Deno.env.get("BRAVE_SEARCH_API_KEY");
    const webSearchActive = webSearchEnabled && braveConfigured;

    // Append web search instructions to system prompt
    if (webSearchActive) {
      const docsContext = (hasNonFavDocs || favourites.length > 0)
        ? " or in the imported documents"
        : "";
      systemPrompt += `\n\n# WEB SEARCH

You have access to a web_search tool. Use it according to these rules:

Always search when the user asks about: current events, recent news and developments, anything time-sensitive (prices, scores, weather, standings, elections), specific claims or facts you're not fully confident about, people's current roles or status, or any question where being up-to-date matters.

Never search for: simple conversational messages (greetings, thanks, acknowledgments), questions about well-established facts, concepts, or definitions, requests for creative writing or brainstorming, follow-up questions where the answer is already in the conversation history, or opinions and advice based on general knowledge.

When in doubt, prefer searching - an unnecessary search is better than an outdated answer.

When citing information from web search results, always include the source URL inline in your response text (e.g. "According to [Source Title](URL), ..."). This ensures the user can verify and revisit the sources later.`;
    }

    // --- Fetch last 50 messages ---
    const { data: history } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(50);

    // --- Build messages array ---
    const llmMessages: Array<{ role: string; content: string; tool_call_id?: string }> = [
      { role: "system", content: systemPrompt },
      ...(history ?? []).map((m: { role: string; content: string }) => ({
        role: m.role,
        content: m.content,
      })),
      { role: "user", content: message.trim() },
    ];

    // --- Mistral API key ---
    // API key check happens inside callLLM; surface a clean error if missing.
    const provider = providerFor(chatModel);
    if (!Deno.env.get(provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "deepseek" ? "DEEPSEEK_API_KEY" : "MISTRAL_API_KEY")) {
      return jsonResponse({ error: `${provider} API key not configured` }, 500);
    }

    // Track total token usage across all calls in the chain
    let totalInputChars = 0;
    let totalOutputChars = 0;
    const documentsReferenced: string[] = [];
    const webSearchesPerformed: string[] = [];

    // --- Build tools array ---
    const hasTools = hasDocuments || webSearchActive;
    const tools: Record<string, unknown>[] = [];
    if (hasDocuments) tools.push(buildDocumentTool());
    if (webSearchActive) tools.push(buildWebSearchTool());

    // =========================================================
    // STREAMING PATH — with tool-use support
    // =========================================================
    if (streamRequested) {
      console.log("[stream] entering streaming path for thread", threadId, "hasTools:", hasTools);

      const encoder = new TextEncoder();

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

      function sseEvent(data: Record<string, unknown>): Uint8Array {
        return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
      }

      // ---- TWO-PASS FLOW when tools exist ----
      if (hasTools) {
        console.log("[stream] tools available, using two-pass flow");

        // LLM Call #1: non-streaming with tools
        const call1Body: Record<string, unknown> = {
          model: chatModel,
          messages: llmMessages,
          max_tokens: 2000,
          tools,
          tool_choice: "auto",
          temperature,
        };

        const call1Res = await callLLM(call1Body);

        if (!call1Res.ok) {
          const errText = await call1Res.text();
          console.error("[stream] Call #1 error:", call1Res.status, errText);
          return jsonResponse(
            { error: extractProviderError(providerFor(chatModel), call1Res.status, errText) },
            502
          );
        }

        const call1Data = await call1Res.json();
        const norm1 = normaliseResponse(providerFor(chatModel), call1Data);
        let toolCalls = norm1.toolCalls;

        // Track tokens from Call #1
        totalInputChars += llmMessages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
        const call1Content = cleanLLMContent(norm1.text);
        totalOutputChars += call1Content.length;

        if (toolCalls.length === 0) {
          // No tool use — emit Call #1 text as rapid SSE sequence
          console.log("[stream] no tool use, emitting Call #1 response directly");
          const responseText = call1Content || "No response generated.";

          const readable = new ReadableStream({
            async start(controller) {
              try {
                const chunkSize = 20;
                for (let i = 0; i < responseText.length; i += chunkSize) {
                  const chunk = responseText.slice(i, i + chunkSize);
                  controller.enqueue(sseEvent({ token: chunk }));
                }

                const userMsgRow = {
                  thread_id: threadId,
                  role: "user",
                  content: message.trim(),
                  source_type: "chat",
                  flow_flag: "normal",
                  concise_mode: conciseMode,
                  tutor_mode: tutorMode,
                };
                const assistantMsgRow: Record<string, unknown> = {
                  thread_id: threadId,
                  role: "assistant",
                  content: responseText,
                  source_type: "chat",
                  flow_flag: "normal",
                  concise_mode: conciseMode,
                  tutor_mode: tutorMode,
                  model_used: chatModel,
                };



                const { data: insertedUser } = await adminSupabase
                  .from("chat_messages")
                  .insert(userMsgRow)
                  .select()
                  .single();

                const { data: insertedAssistant } = await adminSupabase
                  .from("chat_messages")
                  .insert(assistantMsgRow)
                  .select()
                  .single();

                const estimatedTokens = Math.ceil((totalInputChars + totalOutputChars) / 4);
                const newTotal = profile.tokens_used_this_period + estimatedTokens;
                await adminSupabase
                  .from("profiles")
                  .update({ tokens_used_this_period: newTotal })
                  .eq("id", user.id);

                const promptColumn = tutorMode ? "chat_prompt_count_tutor" : "chat_prompt_count_normal";
                const { data: cs } = await adminSupabase
                  .from("project_stats")
                  .select(promptColumn)
                  .eq("project_id", thread.project_id)
                  .single();
                if (cs) {
                  const cnt = (cs as Record<string, number>)[promptColumn] || 0;
                  await adminSupabase
                    .from("project_stats")
                    .update({ [promptColumn]: cnt + 1 })
                    .eq("project_id", thread.project_id);
                }

                controller.enqueue(
                  sseEvent({
                    done: true,
                    user_message: insertedUser,
                    assistant_message: insertedAssistant,
                    budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
                  })
                );
              } catch (err) {
                console.error("[stream] error in no-tool path:", err);
                try {
                  controller.enqueue(sseEvent({ done: true, error: "Messages may not have been saved." }));
                } catch { /* client gone */ }
              } finally {
                controller.close();
              }
            },
          });

          return createSSEResponse(readable);
        }

        // ---- Tool use detected — STREAM-FIRST approach ----
        // Use ReadableStream so Deno keeps the isolate alive until controller.close()
        console.log("[stream] tool use detected:", toolCalls.length, "calls — using stream-first approach");

        const readable = new ReadableStream({
          async start(controller) {
            try {
              // Build conversation with tool results
              const toolMessages: Array<Record<string, unknown>> = [
                ...llmMessages,
                norm1.assistantMessage as unknown as Record<string, unknown>,
              ];

              // Resolve tool calls iteratively (up to 5 iterations)
              let iteration = 0;
              const MAX_ITERATIONS = 5;
              let currentToolCalls = toolCalls;

              while (currentToolCalls.length > 0 && iteration < MAX_ITERATIONS) {
                iteration++;
                console.log(`[stream] tool iteration ${iteration}, ${currentToolCalls.length} calls`);

                for (const tc of currentToolCalls.slice(0, 5)) {
                  if (tc.name === "read_imported_document") {
                    const docId = tc.arguments.document_id as string;
                    console.log("[stream] reading document:", docId);
                    documentsReferenced.push(docId);

                    try { controller.enqueue(sseEvent({ phase: "reading_documents" })); } catch { /* */ }

                    const { data: docData } = await adminSupabase
                      .from("imported_documents")
                      .select("extracted_text, file_name")
                      .eq("id", docId)
                      .eq("project_id", thread.project_id)
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
                    console.log("[stream] web search:", query);
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

                // Check if the LLM wants to make more tool calls
                if (iteration < MAX_ITERATIONS) {
                  const nextRes = await callLLM({
                      model: chatModel,
                      messages: toolMessages as any,
                      max_tokens: 2000,
                      tools: tools as any,
                      temperature,
                    });

                  if (!nextRes.ok) {
                    currentToolCalls = [];
                    break;
                  }

                  const nextData = await nextRes.json();
                  const nextNorm = normaliseResponse(providerFor(chatModel), nextData);
                  const nextContent = cleanLLMContent(nextNorm.text);
                  totalOutputChars += nextContent.length;
                  currentToolCalls = nextNorm.toolCalls;

                  if (currentToolCalls.length > 0) {
                    toolMessages.push(nextNorm.assistantMessage as unknown as Record<string, unknown>);
                  } else {
                    // No more tool calls — discard any text from intermediate call
                    // and fall through to a proper streaming Call #2
                    break;
                  }
                }
              }


              // LLM Call #2: streaming with tool results (no tools this time)
              console.log("[stream] starting Call #2 streaming");
              const call2Res = await callLLM({
                  model: chatModel,
                  messages: toolMessages,
                  max_tokens: 2000,
                  stream: true,
                  temperature,
                });

              if (!call2Res.ok) {
                const errText = await call2Res.text();
                console.error("[stream] Call #2 error:", call2Res.status, errText);
                const msg = extractProviderError(providerFor(chatModel), call2Res.status, errText);
                try { controller.enqueue(sseEvent({ done: true, error: msg })); } catch { /* */ }
                controller.close();
                return;
              }

              // Read Call #2 stream manually and forward tokens
              let fullResponse = "";
              let promptCounted = false;
              const decoder = new TextDecoder();
              let sseBuffer = "";
              const reader = call2Res.body!.getReader();

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
                  if (payload === "[DONE]") {
                    if (!promptCounted) {
                      promptCounted = true;
                      const promptColumn = tutorMode ? "chat_prompt_count_tutor" : "chat_prompt_count_normal";
                      adminSupabase
                        .from("project_stats")
                        .select(promptColumn)
                        .eq("project_id", thread.project_id)
                        .single()
                        .then(({ data: cs }) => {
                          if (cs) {
                            const cnt = (cs as Record<string, number>)[promptColumn] || 0;
                            adminSupabase
                              .from("project_stats")
                              .update({ [promptColumn]: cnt + 1 })
                              .eq("project_id", thread.project_id);
                          }
                        });
                    }
                    continue;
                  }

                  try {
                    const parsed = JSON.parse(payload);
                    const delta = extractDeltaText(parsed, providerFor(chatModel));
                    if (delta) {
                      fullResponse += delta;
                      try { controller.enqueue(sseEvent({ token: delta })); } catch { /* client gone */ }
                    }
                  } catch { /* skip malformed */ }
                }
              }

              // Clean and persist
              fullResponse = cleanLLMContent(fullResponse);
              totalOutputChars += fullResponse.length;

              const userMsgRow = {
                thread_id: threadId,
                role: "user",
                content: message.trim(),
                source_type: "chat",
                flow_flag: "normal",
                concise_mode: conciseMode,
                tutor_mode: tutorMode,
              };
              const assistantMsgRow: Record<string, unknown> = {
                thread_id: threadId,
                role: "assistant",
                content: fullResponse || "No response generated.",
                source_type: "chat",
                flow_flag: "normal",
                concise_mode: conciseMode,
                tutor_mode: tutorMode,
                model_used: chatModel,
              };

              if (documentsReferenced.length > 0) {
                assistantMsgRow.documents_referenced = documentsReferenced;
              }
              if (webSearchesPerformed.length > 0) {
                assistantMsgRow.web_searches_performed = webSearchesPerformed;
              }

              const { data: insertedUser } = await adminSupabase
                .from("chat_messages")
                .insert(userMsgRow)
                .select()
                .single();

              const { data: insertedAssistant } = await adminSupabase
                .from("chat_messages")
                .insert(assistantMsgRow)
                .select()
                .single();

              const estimatedTokens = Math.ceil((totalInputChars + totalOutputChars) / 4);
              const newTotal = profile.tokens_used_this_period + estimatedTokens;
              await adminSupabase
                .from("profiles")
                .update({ tokens_used_this_period: newTotal })
                .eq("id", user.id);

              try {
                controller.enqueue(
                  sseEvent({
                    done: true,
                    user_message: insertedUser,
                    assistant_message: insertedAssistant,
                    budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
                  })
                );
              } catch { /* client gone */ }
            } catch (err) {
              console.error("[stream] error in tool-use path:", err);
              try {
                controller.enqueue(sseEvent({ done: true, error: "AI service temporarily unavailable." }));
              } catch { /* client gone */ }
            } finally {
              controller.close();
            }
          },
        });

        return createSSEResponse(readable);
      }
      // ---- NO TOOLS — streaming path using ReadableStream ----
      console.log("[stream] no tools, standard streaming path");

      const llmRes = await callLLM({
          model: chatModel,
          messages: llmMessages,
          max_tokens: 2000,
          stream: true,
          temperature,
        });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        console.error("[stream] LLM API error:", llmRes.status, errText);
        return jsonResponse(
          { error: extractProviderError(providerFor(chatModel), llmRes.status, errText) },
          502
        );
      }

      console.log("[stream] LLM response received, streaming via ReadableStream");

      const readable = new ReadableStream({
        async start(controller) {
          let fullResponse = "";
          let promptCounted = false;
          const decoder = new TextDecoder();
          let sseBuffer = "";

          try {
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
                if (payload === "[DONE]") {
                  if (!promptCounted) {
                    promptCounted = true;
                    const promptColumn = tutorMode
                      ? "chat_prompt_count_tutor"
                      : "chat_prompt_count_normal";
                    adminSupabase
                      .from("project_stats")
                      .select(promptColumn)
                      .eq("project_id", thread.project_id)
                      .single()
                      .then(({ data: cs }) => {
                        if (cs) {
                          const cnt = (cs as Record<string, number>)[promptColumn] || 0;
                          adminSupabase
                            .from("project_stats")
                            .update({ [promptColumn]: cnt + 1 })
                            .eq("project_id", thread.project_id)
                            .then(() =>
                              console.log("[stream] prompt count incremented for", thread.project_id)
                            );
                        }
                      });
                  }
                  continue;
                }

                try {
                  const parsed = JSON.parse(payload);
                  const delta = extractDeltaText(parsed, providerFor(chatModel));
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

            // Persist
            console.log("[stream] flush() started");
            fullResponse = cleanLLMContent(fullResponse);

            const userMsg = {
              thread_id: threadId,
              role: "user",
              content: message.trim(),
              source_type: "chat",
              flow_flag: "normal",
              concise_mode: conciseMode,
              tutor_mode: tutorMode,
            };
            const assistantMsg = {
              thread_id: threadId,
              role: "assistant",
              content: fullResponse || "No response generated.",
              source_type: "chat",
              flow_flag: "normal",
              concise_mode: conciseMode,
              tutor_mode: tutorMode,
              model_used: chatModel,
            };

            const { data: insertedUser } = await adminSupabase
              .from("chat_messages")
              .insert(userMsg)
              .select()
              .single();

            const { data: insertedAssistant } = await adminSupabase
              .from("chat_messages")
              .insert(assistantMsg)
              .select()
              .single();

            const inputChars = llmMessages.reduce(
              (sum, m) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length),
              0
            );
            const outputChars = fullResponse.length;
            const estimatedTokens = Math.ceil((inputChars + outputChars) / 4);
            const newTotal = profile.tokens_used_this_period + estimatedTokens;

            await adminSupabase
              .from("profiles")
              .update({ tokens_used_this_period: newTotal })
              .eq("id", user.id);

            try {
              controller.enqueue(
                sseEvent({
                  done: true,
                  user_message: insertedUser,
                  assistant_message: insertedAssistant,
                  budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
                })
              );
            } catch { /* client gone */ }

            console.log("[stream] flush() completed — persistence done");
          } catch (persistErr) {
            console.error("[stream] persistence error:", persistErr);
            try {
              controller.enqueue(
                sseEvent({
                  done: true,
                  error: "Messages may not have been saved.",
                })
              );
            } catch { /* client gone */ }
            console.log("[stream] flush() completed — with error");
          } finally {
            controller.close();
          }
        },
      });

      return createSSEResponse(readable);
    }

    // =========================================================
    // NON-STREAMING PATH (unchanged)
    // =========================================================
    const llmRes = await callLLM({
        model: chatModel,
        messages: llmMessages,
        max_tokens: 2000,
        temperature,
      });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error("LLM API error:", llmRes.status, errText);
      return jsonResponse(
        { error: extractProviderError(providerFor(chatModel), llmRes.status, errText) },
        502
      );
    }

    const llmData = await llmRes.json();
    const assistantText = cleanLLMContent(
      llmData.choices?.[0]?.message?.content ?? "No response generated."
    );

    // --- Persist messages ---
    const userMsg = {
      thread_id: threadId,
      role: "user",
      content: message.trim(),
      source_type: "chat",
      flow_flag: "normal",
      concise_mode: conciseMode,
      tutor_mode: tutorMode,
    };
    const assistantMsg = {
      thread_id: threadId,
      role: "assistant",
      content: assistantText,
      source_type: "chat",
      flow_flag: "normal",
      concise_mode: conciseMode,
      tutor_mode: tutorMode,
      model_used: chatModel,
    };

    const { data: insertedUser } = await supabase
      .from("chat_messages")
      .insert(userMsg)
      .select()
      .single();

    const { data: insertedAssistant } = await supabase
      .from("chat_messages")
      .insert(assistantMsg)
      .select()
      .single();

    // --- Estimate tokens & update budget ---
    const inputChars = llmMessages.reduce(
      (sum, m) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length),
      0
    );
    const outputChars = assistantText.length;
    const estimatedTokens = Math.ceil((inputChars + outputChars) / 4);

    const newTotal =
      profile.tokens_used_this_period + estimatedTokens;

    await supabase
      .from("profiles")
      .update({ tokens_used_this_period: newTotal })
      .eq("id", user.id);

    // --- Increment prompt count in project_stats ---
    const promptColumn = tutorMode
      ? "chat_prompt_count_tutor"
      : "chat_prompt_count_normal";

    const { data: currentStats } = await supabase
      .from("project_stats")
      .select(promptColumn)
      .eq("project_id", thread.project_id)
      .single();

    if (currentStats) {
      const currentCount = (currentStats as Record<string, number>)[promptColumn] || 0;
      await supabase
        .from("project_stats")
        .update({ [promptColumn]: currentCount + 1 })
        .eq("project_id", thread.project_id);
    }

    return jsonResponse({
      reply: assistantText,
      tokens_used: estimatedTokens,
      budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
      user_message: insertedUser,
      assistant_message: insertedAssistant,
    });
  } catch (err) {
    console.error("Chat function error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
