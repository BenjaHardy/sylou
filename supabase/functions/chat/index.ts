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
    let systemPrompt = tutorMode
      ? "TUTOR_MODE_SYSTEM_PROMPT"
      : "CLASSIC_MODE_SYSTEM_PROMPT";

    if (conciseMode) {
      systemPrompt += "\n\nCONCISE_MODE_MODIFIER";
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

    // --- Call Mistral ---
    const mistralKey = Deno.env.get("MISTRAL_API_KEY");
    if (!mistralKey) {
      return jsonResponse({ error: "Mistral API key not configured" }, 500);
    }

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

    // Fetch current count then increment
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
