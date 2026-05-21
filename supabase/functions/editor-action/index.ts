import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callLLM, providerFor } from "./_llm.ts";

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
 * Canonical version: supabase/functions/chat/index.ts
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

const ACTION_PROMPTS: Record<string, string> = {
  fix_grammar:
    "Fix any grammar, spelling, and punctuation errors in the following text. Return only the corrected text.",
  rewrite:
    "Rewrite the following text to improve clarity and flow while preserving the meaning. Return only the rewritten text.",
  simplify:
    "Simplify the following text to make it more accessible while preserving the key meaning. Return only the simplified text.",
  expand:
    "Expand the following text with more detail and depth while maintaining the same tone. Return only the expanded text.",
  translate: "Translate the following text to {target_language}. Return only the translation.",
};

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

    // --- Token budget + preferred model ---
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("tokens_used_this_period, monthly_token_budget, preferred_chat_model")
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
    const projectId: string = body.project_id;
    const actionType: string = body.action_type;
    const selectedText: string = body.selected_text;
    const targetLanguage: string | undefined = body.target_language;
    const selectedTextSource: string | undefined = body.selected_text_source;
    const streamRequested: boolean = body.stream === true;

    if (!projectId || !actionType || !selectedText) {
      return jsonResponse(
        { error: "project_id, action_type, and selected_text are required" },
        400
      );
    }

    const validActions = ["fix_grammar", "rewrite", "simplify", "expand", "translate"];
    if (!validActions.includes(actionType)) {
      return jsonResponse({ error: `Invalid action_type: ${actionType}` }, 400);
    }

    if (actionType === "translate" && !targetLanguage) {
      return jsonResponse(
        { error: "target_language is required for translate action" },
        400
      );
    }

    // --- Verify project ownership (RLS handles this) ---
    const { data: project, error: projectErr } = await supabase
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .single();

    if (projectErr || !project) {
      return jsonResponse({ error: "Project not found or not owned by user" }, 404);
    }

    // --- Build prompt ---
    let prompt = ACTION_PROMPTS[actionType];
    if (actionType === "translate") {
      prompt = prompt.replace("{target_language}", targetLanguage!);
    }

    // --- Inject favourite reference documents into the system prompt ---
    const serviceRoleKeyForDocs = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminForDocs = createClient(supabaseUrl, serviceRoleKeyForDocs);
    const { data: favDocs } = await adminForDocs
      .from("imported_documents")
      .select("file_name, extracted_text")
      .eq("project_id", projectId)
      .eq("is_favourite", true);

    const favourites = (favDocs ?? []).filter((d: any) => d.extracted_text);
    if (favourites.length > 0) {
      let favBlock = `\n\n# REFERENCE DOCUMENTS (ALWAYS AVAILABLE)\n\nThe following documents have been provided by the user as key reference material. Their full content is included below. Use them to inform your response when relevant.\n\n`;
      for (const doc of favourites) {
        favBlock += `=== ${doc.file_name} ===\n\n${doc.extracted_text}\n\n`;
      }
      prompt += favBlock;
    }

    const llmMessages = [
      { role: "system", content: prompt },
      { role: "user", content: selectedText },
    ];

    // --- Resolve chat model from request body or profile ---
    const requestedModel: string | undefined = (body as { model?: string }).model;
    const chatModel: string =
      requestedModel || profile.preferred_chat_model || "mistral-large-latest";
    const provider = providerFor(chatModel);
    const providerKeyEnv = provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "deepseek" ? "DEEPSEEK_API_KEY" : "MISTRAL_API_KEY";
    if (!Deno.env.get(providerKeyEnv)) {
      return jsonResponse({ error: `${provider} API key not configured` }, 500);
    }

    // =========================================================
    // STREAMING PATH
    // =========================================================
    if (streamRequested) {
      console.log("[stream:editor-action] entering streaming path");

      const llmRes = await callLLM({
        model: chatModel,
        messages: llmMessages as any,
        max_tokens: 1000,
        stream: true,
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        console.error("[stream:editor-action] Mistral API error:", llmRes.status, errText);
        return jsonResponse(
          { error: "AI service temporarily unavailable. Please try again." },
          502
        );
      }

      console.log("[stream:editor-action] LLM response received, piping");

      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

      let fullResponse = "";
      let clientDisconnected = false;
      const encoder = new TextEncoder();
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
            if (payload === "[DONE]") continue;

            try {
              const parsed = JSON.parse(payload);
              const delta = extractDeltaText(parsed, provider);
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
          console.log("[stream:editor-action] LLM stream complete, persisting");

          try {
            const proposedText = fullResponse || "No response generated.";
            const inputChars = llmMessages.reduce((sum, m) => sum + m.content.length, 0);
            const outputChars = proposedText.length;
            const estimatedTokens = Math.ceil((inputChars + outputChars) / 4);

            // Build instruction_text
            let instructionText: string | null = actionType === "translate" ? `translate:${targetLanguage}` : null;
            if (selectedTextSource) {
              instructionText = instructionText
                ? `${instructionText} | Source: ${selectedTextSource}`
                : `Source: ${selectedTextSource}`;
            }

            const { data: actionRow } = await adminSupabase
              .from("ai_editor_actions")
              .insert({
                project_id: projectId,
                action_type: actionType,
                selected_text_preview: selectedText.slice(0, 500),
                ai_response_preview: proposedText.slice(0, 500),
                char_count_original: selectedText.length,
                char_count_result: proposedText.length,
                outcome: "pending",
                instruction_text: instructionText,
              })
              .select("id")
              .single();

            // Log token usage
            await adminSupabase.from("token_usage").insert({
              user_id: user.id,
              project_id: projectId,
              function_name: "editor-action",
              model_used: chatModel,
              input_tokens: Math.ceil(inputChars / 4),
              output_tokens: Math.ceil(outputChars / 4),
            });

            // Update budget
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
                      result: proposedText,
                      action_id: actionRow?.id ?? null,
                      budget_remaining: profile.monthly_token_budget - newTotal,
                    })}\n\n`
                  )
                );
              } catch {
                clientDisconnected = true;
              }
            }

            console.log("[stream:editor-action] persistence complete");
          } catch (persistErr) {
            console.error("[stream:editor-action] persistence error:", persistErr);
            if (!clientDisconnected) {
              try {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({ done: true, error: "Action may not have been saved." })}\n\n`
                  )
                );
              } catch {
                // client gone
              }
            }
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
    const llmRes = await callLLM({
      model: chatModel,
      messages: llmMessages as any,
      max_tokens: 1000,
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
    let proposedText: string;
    if (provider === "anthropic") {
      const blocks: any[] = llmData?.content ?? [];
      proposedText = blocks.filter(b => b?.type === "text").map(b => b.text ?? "").join("") || "No response generated.";
    } else {
      proposedText = llmData.choices?.[0]?.message?.content ?? "No response generated.";
    }

    // --- Estimate tokens ---
    const inputChars = llmMessages.reduce((sum, m) => sum + m.content.length, 0);
    const outputChars = proposedText.length;
    const estimatedTokens = Math.ceil((inputChars + outputChars) / 4);

    // --- Log to ai_editor_actions ---
    let instructionText: string | null = actionType === "translate" ? `translate:${targetLanguage}` : null;
    if (selectedTextSource) {
      instructionText = instructionText
        ? `${instructionText} | Source: ${selectedTextSource}`
        : `Source: ${selectedTextSource}`;
    }

    const { data: actionRow, error: actionErr } = await supabase
      .from("ai_editor_actions")
      .insert({
        project_id: projectId,
        action_type: actionType,
        selected_text_preview: selectedText.slice(0, 500),
        ai_response_preview: proposedText.slice(0, 500),
        char_count_original: selectedText.length,
        char_count_result: proposedText.length,
        outcome: "pending",
        instruction_text: instructionText,
      })
      .select("id")
      .single();

    if (actionErr) {
      console.error("Failed to log ai_editor_action:", actionErr);
    }

    // --- Log token usage ---
    await supabase.from("token_usage").insert({
      user_id: user.id,
      project_id: projectId,
      function_name: "editor-action",
      model_used: chatModel,
      input_tokens: Math.ceil(inputChars / 4),
      output_tokens: Math.ceil(outputChars / 4),
    });

    // --- Update budget ---
    const newTotal = profile.tokens_used_this_period + estimatedTokens;
    await supabase
      .from("profiles")
      .update({ tokens_used_this_period: newTotal })
      .eq("id", user.id);

    return jsonResponse({
      proposed_text: proposedText,
      action_id: actionRow?.id ?? null,
      tokens_used: estimatedTokens,
      budget_remaining: profile.monthly_token_budget - newTotal,
    });
  } catch (err) {
    console.error("Editor action error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
