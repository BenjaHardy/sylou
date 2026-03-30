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
 * Extract the text delta from a streaming chunk, model-agnostic.
 * - Mistral / OpenAI-compatible: choices[0].delta.content
 * - Anthropic (future): delta.text on content_block_delta events
 */
function extractDeltaText(
  parsed: Record<string, unknown>,
  _provider: string
): string | null {
  // Mistral / OpenAI format
  const choices = parsed.choices as
    | Array<{ delta?: { content?: string } }>
    | undefined;
  if (choices?.[0]?.delta?.content) {
    return choices[0].delta.content;
  }
  // Anthropic format (future)
  if (parsed.type === "content_block_delta") {
    const delta = parsed.delta as { text?: string } | undefined;
    if (delta?.text) return delta.text;
  }
  return null;
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

    // --- Fetch last 50 messages ---
    const { data: history } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(50);

    // --- Build messages array ---
    const llmMessages = [
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

    // =========================================================
    // STREAMING PATH
    // =========================================================
    if (streamRequested) {
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
        console.error("Mistral API error:", llmRes.status, errText);
        return jsonResponse(
          { error: "AI service temporarily unavailable. Please try again." },
          502
        );
      }

      // We need the service role client for persistence after user's request scope
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

      let fullResponse = "";
      let clientDisconnected = false;
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const stream = new ReadableStream({
        async start(controller) {
          const reader = llmRes.body!.getReader();

          // Helper: safely write to the SSE stream
          function sendSSE(eventData: string) {
            if (clientDisconnected) return;
            try {
              controller.enqueue(encoder.encode(`data: ${eventData}\n\n`));
            } catch {
              clientDisconnected = true;
            }
          }

          try {
            let buffer = "";
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              // Keep last potentially incomplete line in buffer
              buffer = lines.pop() ?? "";

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
                    sendSSE(JSON.stringify({ token: delta }));
                  }
                } catch {
                  // skip malformed chunk
                }
              }
            }
          } catch (err) {
            console.error("Error reading LLM stream:", err);
          }

          // --- Persist messages (always, even if client disconnected) ---
          try {
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

            // --- Token budget ---
            const inputChars = llmMessages.reduce(
              (sum, m) => sum + m.content.length,
              0
            );
            const outputChars = fullResponse.length;
            const estimatedTokens = Math.ceil((inputChars + outputChars) / 4);
            const newTotal = profile.tokens_used_this_period + estimatedTokens;

            await adminSupabase
              .from("profiles")
              .update({ tokens_used_this_period: newTotal })
              .eq("id", user.id);

            // --- Increment prompt count ---
            const promptColumn = tutorMode
              ? "chat_prompt_count_tutor"
              : "chat_prompt_count_normal";

            const { data: currentStats } = await adminSupabase
              .from("project_stats")
              .select(promptColumn)
              .eq("project_id", thread.project_id)
              .single();

            if (currentStats) {
              const currentCount =
                (currentStats as Record<string, number>)[promptColumn] || 0;
              await adminSupabase
                .from("project_stats")
                .update({ [promptColumn]: currentCount + 1 })
                .eq("project_id", thread.project_id);
            }

            // Send final done event with persisted messages
            sendSSE(
              JSON.stringify({
                done: true,
                user_message: insertedUser,
                assistant_message: insertedAssistant,
                budget_remaining: profile.monthly_token_budget - newTotal,
              })
            );
          } catch (persistErr) {
            console.error("Error persisting streamed messages:", persistErr);
            sendSSE(
              JSON.stringify({
                done: true,
                error: "Messages may not have been saved.",
              })
            );
          }

          if (!clientDisconnected) {
            try {
              controller.close();
            } catch {
              // already closed
            }
          }
        },
      });

      return new Response(stream, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
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
    const assistantText =
      llmData.choices?.[0]?.message?.content ?? "No response generated.";

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
      (sum, m) => sum + m.content.length,
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
