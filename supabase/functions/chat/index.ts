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
    | Array<{ delta?: { content?: string } }>
    | undefined;
  if (choices?.[0]?.delta?.content) {
    return choices[0].delta.content;
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

    // --- Parse body ---
    const body = await req.json();
    const threadId: string = body.thread_id;
    const message: string = body.message;
    const conciseMode: boolean = body.concise_mode ?? false;
    const streamRequested: boolean = body.stream === true;
    const webSearchEnabled: boolean = body.web_search_enabled ?? false;

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
      .select("tutor_mode")
      .eq("id", thread.project_id)
      .single();

    const tutorMode = project?.tutor_mode ?? false;

    // --- Build system prompt ---
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    const { data: importedDocs } = await adminSupabase
      .from("imported_documents")
      .select("id, file_name, summary")
      .eq("project_id", thread.project_id);

    const hasDocuments = importedDocs && importedDocs.length > 0;

    // Append document index to system prompt if documents exist
    if (hasDocuments) {
      let docIndex = `\n\n# IMPORTED DOCUMENTS\n\nThe user has imported the following reference documents into this project. You can see their titles and summaries below. If you need the full text of any document to answer the user's question, use the read_imported_document tool. Only retrieve documents that are directly relevant to the user's query.\n\n`;
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

You have access to a web_search tool, but using it is OPTIONAL. Only use it when the user's message genuinely requires current information, recent data, or facts you don't have in your training data${docsContext}.

Do NOT use web search for:
- Simple conversational replies, greetings, or acknowledgments
- Topics you can answer confidently from your training knowledge
- Follow-up questions about information you already provided

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
    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    if (!mistralKey) {
      return jsonResponse({ error: "Mistral API key not configured" }, 500);
    }

    // Track total token usage across all calls in the chain
    let totalInputChars = 0;
    let totalOutputChars = 0;
    const documentsReferenced: string[] = [];
    const webSearchesPerformed: string[] = [];

    // --- Build tools array ---
    const hasTools = hasDocuments || webSearchEnabled;
    const tools: Record<string, unknown>[] = [];
    if (hasDocuments) tools.push(buildDocumentTool());
    if (webSearchEnabled) tools.push(buildWebSearchTool());

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
          model: "mistral-large-latest",
          messages: llmMessages,
          max_tokens: 2000,
          tools,
          tool_choice: "auto",
        };

        const call1Res = await fetch("https://api.mistral.ai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${mistralKey}`,
          },
          body: JSON.stringify(call1Body),
        });

        if (!call1Res.ok) {
          const errText = await call1Res.text();
          console.error("[stream] Call #1 error:", call1Res.status, errText);
          return jsonResponse(
            { error: "AI service temporarily unavailable. Please try again." },
            502
          );
        }

        const call1Data = await call1Res.json();
        let toolCalls = extractToolCalls(call1Data);

        // Track tokens from Call #1
        totalInputChars += llmMessages.reduce((s, m) => s + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length), 0);
        const call1Content = cleanLLMContent(call1Data.choices?.[0]?.message?.content ?? "");
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
                };
                const assistantMsgRow: Record<string, unknown> = {
                  thread_id: threadId,
                  role: "assistant",
                  content: responseText,
                  source_type: "chat",
                  flow_flag: "normal",
                  concise_mode: conciseMode,
                  model_used: "mistral-large-latest",
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
                    budget_remaining: profile.monthly_token_budget - newTotal,
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
                call1Data.choices[0].message,
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
                  const nextRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${mistralKey}`,
                    },
                    body: JSON.stringify({
                      model: "mistral-large-latest",
                      messages: toolMessages,
                      max_tokens: 2000,
                      tools,
                      tool_choice: "auto",
                    }),
                  });

                  if (!nextRes.ok) {
                    currentToolCalls = [];
                    break;
                  }

                  const nextData = await nextRes.json();
                  const nextContent = cleanLLMContent(nextData.choices?.[0]?.message?.content ?? "");
                  totalOutputChars += nextContent.length;
                  currentToolCalls = extractToolCalls(nextData);

                  if (currentToolCalls.length > 0) {
                    toolMessages.push(nextData.choices[0].message);
                  } else {
                    // No more tool calls — if there's text content, emit it
                    if (nextContent) {
                      const responseText = nextContent;
                      const chunkSize = 20;
                      for (let i = 0; i < responseText.length; i += chunkSize) {
                        try { controller.enqueue(sseEvent({ token: responseText.slice(i, i + chunkSize) })); } catch { /* */ }
                      }

                      const userMsgRow = {
                        thread_id: threadId,
                        role: "user",
                        content: message.trim(),
                        source_type: "chat",
                        flow_flag: "normal",
                        concise_mode: conciseMode,
                      };
                      const assistantMsgRow: Record<string, unknown> = {
                        thread_id: threadId,
                        role: "assistant",
                        content: responseText,
                        source_type: "chat",
                        flow_flag: "normal",
                        concise_mode: conciseMode,
                        model_used: "mistral-large-latest",
                      };
                      if (documentsReferenced.length > 0) assistantMsgRow.documents_referenced = documentsReferenced;
                      if (webSearchesPerformed.length > 0) assistantMsgRow.web_searches_performed = webSearchesPerformed;

                      const { data: insertedUser } = await adminSupabase.from("chat_messages").insert(userMsgRow).select().single();
                      const { data: insertedAssistant } = await adminSupabase.from("chat_messages").insert(assistantMsgRow).select().single();

                      const estimatedTokens = Math.ceil((totalInputChars + totalOutputChars) / 4);
                      const newTotal = profile.tokens_used_this_period + estimatedTokens;
                      await adminSupabase.from("profiles").update({ tokens_used_this_period: newTotal }).eq("id", user.id);

                      const promptColumn = tutorMode ? "chat_prompt_count_tutor" : "chat_prompt_count_normal";
                      const { data: cs } = await adminSupabase.from("project_stats").select(promptColumn).eq("project_id", thread.project_id).single();
                      if (cs) {
                        const cnt = (cs as Record<string, number>)[promptColumn] || 0;
                        await adminSupabase.from("project_stats").update({ [promptColumn]: cnt + 1 }).eq("project_id", thread.project_id);
                      }

                      try {
                        controller.enqueue(sseEvent({
                          done: true,
                          user_message: insertedUser,
                          assistant_message: insertedAssistant,
                          budget_remaining: profile.monthly_token_budget - newTotal,
                        }));
                      } catch { /* */ }
                      controller.close();
                      return; // done
                    }
                    break;
                  }
                }
              }

              // LLM Call #2: streaming with tool results (no tools this time)
              console.log("[stream] starting Call #2 streaming");
              const call2Res = await fetch("https://api.mistral.ai/v1/chat/completions", {
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

              if (!call2Res.ok) {
                const errText = await call2Res.text();
                console.error("[stream] Call #2 error:", call2Res.status, errText);
                try { controller.enqueue(sseEvent({ done: true, error: "AI service temporarily unavailable." })); } catch { /* */ }
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
              totalOutputChars += fullResponse.length;

              const userMsgRow = {
                thread_id: threadId,
                role: "user",
                content: message.trim(),
                source_type: "chat",
                flow_flag: "normal",
                concise_mode: conciseMode,
              };
              const assistantMsgRow: Record<string, unknown> = {
                thread_id: threadId,
                role: "assistant",
                content: fullResponse || "No response generated.",
                source_type: "chat",
                flow_flag: "normal",
                concise_mode: conciseMode,
                model_used: "mistral-large-latest",
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
                    budget_remaining: profile.monthly_token_budget - newTotal,
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
      // ---- NO TOOLS — original streaming path ----
      console.log("[stream] no tools, standard streaming path");

      const llmRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${mistralKey}`,
        },
        body: JSON.stringify({
          model: "mistral-large-latest",
          messages: llmMessages,
          max_tokens: 2000,
          stream: true,
        }),
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        console.error("[stream] Mistral API error:", llmRes.status, errText);
        return jsonResponse(
          { error: "AI service temporarily unavailable. Please try again." },
          502
        );
      }

      console.log("[stream] LLM response received, piping");

      let fullResponse = "";
      let clientDisconnected = false;
      let promptCounted = false;
      const decoder = new TextDecoder();
      let sseBuffer = "";

      const transform = new TransformStream({
        transform(chunk, controller) {
          sseBuffer += decoder.decode(chunk, { stream: true });
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
              const delta = extractDeltaText(parsed, "mistral");
              if (delta) {
                fullResponse += delta;
                if (!clientDisconnected) {
                  try {
                    controller.enqueue(
                      encoder.encode(`data: ${JSON.stringify({ token: delta })}\n\n`)
                    );
                  } catch {
                    clientDisconnected = true;
                  }
                }
              }
            } catch {
              // skip malformed chunk
            }
          }
        },

        async flush(controller) {
          console.log("[stream] flush() started");

          try {
            fullResponse = cleanLLMContent(fullResponse);

            const userMsg = {
              thread_id: threadId,
              role: "user",
              content: message.trim(),
              source_type: "chat",
              flow_flag: "normal",
              concise_mode: conciseMode,
            };
            const assistantMsg = {
              thread_id: threadId,
              role: "assistant",
              content: fullResponse || "No response generated.",
              source_type: "chat",
              flow_flag: "normal",
              concise_mode: conciseMode,
              model_used: "mistral-large-latest",
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

            // Token budget
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

            if (!clientDisconnected) {
              try {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      done: true,
                      user_message: insertedUser,
                      assistant_message: insertedAssistant,
                      budget_remaining: profile.monthly_token_budget - newTotal,
                    })}\n\n`
                  )
                );
              } catch {
                clientDisconnected = true;
              }
            }

            console.log("[stream] flush() completed — persistence done");
          } catch (persistErr) {
            console.error("[stream] persistence error:", persistErr);
            if (!clientDisconnected) {
              try {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      done: true,
                      error: "Messages may not have been saved.",
                    })}\n\n`
                  )
                );
              } catch {
                // client gone
              }
            }
            console.log("[stream] flush() completed — with error");
          }
        },
      });

      const outputStream = llmRes.body!.pipeThrough(transform);

      return new Response(outputStream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "X-Accel-Buffering": "no",
          Connection: "keep-alive",
        },
      });
    }

    // =========================================================
    // NON-STREAMING PATH (unchanged)
    // =========================================================
    const llmRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${mistralKey}`,
      },
      body: JSON.stringify({
        model: "mistral-large-latest",
        messages: llmMessages,
        max_tokens: 2000,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error("Mistral API error:", llmRes.status, errText);
      return jsonResponse(
        { error: "AI service temporarily unavailable. Please try again." },
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
    };
    const assistantMsg = {
      thread_id: threadId,
      role: "assistant",
      content: assistantText,
      source_type: "chat",
      flow_flag: "normal",
      concise_mode: conciseMode,
      model_used: "mistral-large-latest",
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
      budget_remaining: profile.monthly_token_budget - newTotal,
      user_message: insertedUser,
      assistant_message: insertedAssistant,
    });
  } catch (err) {
    console.error("Chat function error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
