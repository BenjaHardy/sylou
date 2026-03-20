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

// ── helpers ──────────────────────────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
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
  const text = data.choices?.[0]?.message?.content ?? "";
  const inputChars = messages.reduce((s, m) => s + m.content.length, 0);
  return { text, inputChars, outputChars: text.length };
}

// ── Prompt builders ─────────────────────────────────────────────────────────

function buildSummaryPrompt(
  writingContent: string,
  existingSummary: string | null,
  selectedText: string,
  instruction: string,
  sourceModule: string,
  language: string,
): { role: string; content: string }[] {
  const prompt = `You are a writing analysis assistant. Respond in ${language}.

Your task is to produce a brief, focused summary of the user's current writing project, relevant to answering a specific question or fulfilling a specific request.

=== CURRENT WRITING ===
${writingContent}

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

FORMAT:
- Start with "Writing currently includes..."
- Focus on aspects relevant to the user's question
- Include character traits, plot points, arguments, or structural elements ONLY if they are needed to provide a good response
- If an existing summary already covers the relevant information, state "No update needed." and stop
- If the existing summary exists but needs additions, write ONLY the new information to append. Do not repeat what is already in the summary.
- Start additions with "Additionally, ..."
- Keep the summary under 300 words
- Do not include your own analysis or recommendations — just summarize the relevant facts from the writing`;

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

    // ── CONFIRM endpoint ────────────────────────────────────────────────
    if (body.confirm !== undefined) {
      const { confirm, action_id, summary_update, modified } = body;

      if (action_id) {
        const outcome = !confirm ? "rejected" : modified ? "modified" : "accepted";
        await supabase
          .from("ai_editor_actions")
          .update({ outcome })
          .eq("id", action_id);
      }

      if (confirm && thread_id) {
        // Fetch the stored AI response from the action row
        let aiResponseContent = "";
        if (action_id) {
          const { data: actionRow } = await supabase
            .from("ai_editor_actions")
            .select("ai_response_full")
            .eq("id", action_id)
            .single();
          aiResponseContent = actionRow?.ai_response_full ?? "";
        }

        // Log to chat_messages and collect inserted rows
        const insertedMessages = [];

        const userPromptContent = `[Propose] Selected: "${(selected_text || "").slice(0, 200)}"\nInstruction: ${instruction || ""}`;
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

        const { data: responseMsg } = await supabase.from("chat_messages").insert({
          thread_id,
          role: "assistant",
          content: aiResponseContent,
          source_type: "propose_response",
          flow_flag: "normal",
          model_used: "mistral-large-latest",
        }).select().single();
        if (responseMsg) insertedMessages.push(responseMsg);

        // Commit summary
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
      .select("id, tutor_mode, language")
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

    // --- 2. Fetch existing summary ---
    const { data: summaryRow } = await supabase
      .from("writing_summary_log")
      .select("id, summary_text")
      .eq("project_id", project_id)
      .single();

    const existingSummary = summaryRow?.summary_text ?? null;

    // --- 3. Fetch recent chat messages (last 20) ---
    const { data: recentMessages } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("thread_id", thread_id)
      .order("created_at", { ascending: false })
      .limit(20);

    const recentChat = (recentMessages ?? []).reverse();

    // --- 4. LLM Call #1: Writing Summary ---
    const summaryMessages = buildSummaryPrompt(
      writingContent,
      existingSummary,
      selected_text,
      instruction,
      source_module,
      projectLanguage,
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

    // --- 6. LLM Call #2: Context-Aware Response ---
    const tutorMode = project.tutor_mode ?? false;
    const systemPrompt = tutorMode
      ? "You are a writing tutor. Guide the student to improve their own writing through questions and suggestions rather than doing the work for them. Encourage critical thinking."
      : "You are a helpful AI writing assistant. Provide clear, constructive feedback and assistance while respecting the writer's voice and intent.";

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

    const responseResult = await callMistral(mistralKey, responseMessages, 2000);
    const aiResponse = responseResult.text.trim();

    // --- Token totals ---
    const totalInputChars = summaryResult.inputChars + responseResult.inputChars;
    const totalOutputChars = summaryResult.outputChars + responseResult.outputChars;
    const totalTokens = Math.ceil((totalInputChars + totalOutputChars) / 4);

    // --- 9. Log to ai_editor_actions (store full AI response) ---
    const { data: actionRow } = await supabase
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
        instruction_text: instruction.slice(0, 1000),
      })
      .select("id")
      .single();

    // --- Log token usage ---
    await supabase.from("token_usage").insert({
      user_id: user.id,
      project_id,
      function_name: "context-prompt",
      model_used: "mistral-large-latest",
      input_tokens: Math.ceil(totalInputChars / 4),
      output_tokens: Math.ceil(totalOutputChars / 4),
    });

    // --- Atomic budget update ---
    await supabase.rpc("increment_tokens_used", {
      user_uuid: user.id,
      amount: totalTokens,
    });

    const budgetRemaining = profile.monthly_token_budget - profile.tokens_used_this_period - totalTokens;

    // --- 7. For 'ask': insert chat messages & commit summary ---
    const insertedMessages = [];

    if (action_type === "ask") {
      const userPromptContent = `[Ask] Selected: "${selected_text.slice(0, 200)}${selected_text.length > 200 ? "…" : ""}"\nQuestion: ${instruction}`;

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

      const { data: responseMsg } = await supabase.from("chat_messages").insert({
        thread_id,
        role: "assistant",
        content: aiResponse,
        source_type: "ask_response",
        flow_flag: "normal",
        model_used: "mistral-large-latest",
      }).select().single();
      if (responseMsg) insertedMessages.push(responseMsg);

      // Update writing_summary_log
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

    // --- 8. For 'propose': return data, summary stored as pending ---
    // (Summary committed via /confirm endpoint)

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
