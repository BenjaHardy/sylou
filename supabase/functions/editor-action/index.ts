import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { callLLM, providerFor, normaliseResponse, extractProviderError, fallbackReplyText, isTruncatedStop } from "../_shared/_llm.ts";
import { makeSSEHelpers, readProviderStream } from "../_shared/_sse.ts";
import { EDITOR_TEMPERATURE, resolveTemperature } from "../_shared/_temperatures.ts";
import { ALLOWED_MODELS, INPUT_LIMITS, OUTPUT_BUDGETS } from "../_shared/_models.ts";
import { sliceSafe } from "../_shared/_text.ts";
import {
  EDITOR_THINKING, EDITOR_EFFORT, EDITOR_MISTRAL_EFFORT,
  resolveThinking, resolveEffort, resolveMistralEffort, resolveMaxTokens,
} from "../_shared/_thinking.ts";

import { isOverBudget, getBudgetedProfile } from "../_shared/_billing.ts";


// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, POST, OPTIONS");

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
    const { profile, profileErr } = await getBudgetedProfile(supabase, user.id);

    if (profileErr || !profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    if (isOverBudget(profile)) {
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

    if (!projectId || !actionType || !selectedText || typeof selectedText !== "string") {
      return jsonResponse(
        { error: "project_id, action_type, and selected_text are required" },
        400
      );
    }
    if (selectedText.length > INPUT_LIMITS.SELECTED_TEXT_CHARS) {
      return jsonResponse(
        { error: `Selection is too long (max ${INPUT_LIMITS.SELECTED_TEXT_CHARS.toLocaleString("en-US")} characters)` },
        400
      );
    }
    if (targetLanguage !== undefined && (typeof targetLanguage !== "string" || targetLanguage.length > INPUT_LIMITS.SHORT_FIELD_CHARS)) {
      return jsonResponse({ error: "Invalid target_language" }, 400);
    }
    if (selectedTextSource !== undefined && (typeof selectedTextSource !== "string" || selectedTextSource.length > INPUT_LIMITS.SHORT_FIELD_CHARS)) {
      return jsonResponse({ error: "Invalid selected_text_source" }, 400);
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
    // Registry allowlist for the request override — see chat/index.ts for rationale.
    if (requestedModel && !ALLOWED_MODELS.has(requestedModel)) {
      return jsonResponse(
        { error: `Unsupported model: ${sliceSafe(String(requestedModel), 64)}` },
        400
      );
    }
    const chatModel: string =
      requestedModel || profile.preferred_chat_model || "zai-glm-5-3";
    const provider = providerFor(chatModel);
    const temperature = resolveTemperature(EDITOR_TEMPERATURE, chatModel);
    const thinking = resolveThinking(EDITOR_THINKING, chatModel);
    const effort = resolveEffort(EDITOR_EFFORT, chatModel);
    const mistralEffort = resolveMistralEffort(EDITOR_MISTRAL_EFFORT, chatModel);
    const editorMaxTokens = resolveMaxTokens(OUTPUT_BUDGETS.EDITOR_ACTION, chatModel, thinking, mistralEffort !== undefined);
    const providerKeyEnv = provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "deepseek" ? "DEEPSEEK_API_KEY" : "MISTRAL_API_KEY";
    if (!Deno.env.get(providerKeyEnv)) {
      return jsonResponse({ error: `${provider} API key not configured` }, 500);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey);

    // =========================================================
    // STREAMING PATH
    // =========================================================
    if (streamRequested) {
      console.log("[stream:editor-action] entering streaming path");

      const { sseEvent, createSSEResponse } = makeSSEHelpers(corsHeaders);

      const llmRes = await callLLM({
        model: chatModel,
        messages: llmMessages as any,
        max_tokens: editorMaxTokens,
        stream: true,
        temperature,
        thinking,
        effort,
        mistral_effort: mistralEffort,
      });

      if (!llmRes.ok) {
        const errText = await llmRes.text();
        console.error("[stream:editor-action] LLM API error:", llmRes.status, errText);
        return jsonResponse(
          { error: extractProviderError(provider, llmRes.status, errText) },
          502
        );
      }

      console.log("[stream:editor-action] LLM response received, streaming");

      // §7 stream-first pattern (matches chat/context-prompt): we OWN the
      // ReadableStream and keep it open until controller.close(), so the
      // isolate survives a client disconnect and persistence always runs.
      // The previous TransformStream/pipeThrough wiring let client
      // cancellation propagate upstream and abort flush() — a mid-stream
      // disconnect skipped the ai_editor_actions row, token_usage and
      // billing entirely.
      const readable = new ReadableStream({
        async start(controller) {
          let fullResponse: string;
          let clientDisconnected = false;
          // Provider stop reason: max_tokens/length means the rewrite was
          // cut off at the output budget. Surfaced to the client as
          // `truncated` so Accept can warn before replacing the selection.
          let stopReason: string | null = null;

          try {
            fullResponse = await readProviderStream(llmRes, provider, {
              onToken: (delta) => {
                if (!clientDisconnected) {
                  try {
                    controller.enqueue(sseEvent({ token: delta }));
                  } catch {
                    clientDisconnected = true;
                  }
                }
              },
              onStop: (reason) => {
                stopReason = reason;
              },
            });

            console.log("[stream:editor-action] LLM stream complete, persisting");
            if (isTruncatedStop(stopReason)) {
              console.warn("[stream:editor-action] reply truncated at max_tokens", { chars: fullResponse.length });
            }

            try {
              const proposedText = fullResponse || fallbackReplyText(stopReason);
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

              const { data: actionRow, error: actionErr } = await adminSupabase
                .from("ai_editor_actions")
                .insert({
                  project_id: projectId,
                  action_type: actionType,
                  selected_text_preview: sliceSafe(selectedText, 500),
                  ai_response_preview: sliceSafe(proposedText, 500),
                  char_count_original: selectedText.length,
                  char_count_result: proposedText.length,
                  outcome: "pending",
                  instruction_text: instructionText,
                })
                .select("id")
                .single();
              if (actionErr) console.error("[editor-action] ai_editor_actions insert failed:", JSON.stringify(actionErr));

              // Log token usage
              const { error: usageErr } = await adminSupabase.from("token_usage").insert({
                user_id: user.id,
                project_id: projectId,
                function_name: "editor-action",
                model_used: chatModel,
                input_tokens: Math.ceil(inputChars / 4),
                output_tokens: Math.ceil(outputChars / 4),
              });
              if (usageErr) console.error("[editor-action] token_usage insert failed:", JSON.stringify(usageErr));

              // Update budget (atomic RPC, unchanged from P2-1; newTotal is only
              // the request-start estimate for the budget_remaining display).
              const newTotal = profile.tokens_used_this_period + estimatedTokens;
              const { error: rpcErr } = await adminSupabase.rpc("increment_tokens_used", {
                user_uuid: user.id,
                amount: estimatedTokens,
              });
              if (rpcErr) console.error("[editor-action] increment_tokens_used failed:", JSON.stringify(rpcErr));

              if (!clientDisconnected) {
                try {
                  if (actionErr) {
                    // Failed ledger write takes the same path a thrown
                    // persistence error does — never report success over a
                    // missing action row.
                    controller.enqueue(
                      sseEvent({ done: true, error: "Action may not have been saved." })
                    );
                  } else {
                    controller.enqueue(
                      sseEvent({
                        done: true,
                        result: proposedText,
                        truncated: isTruncatedStop(stopReason),
                        action_id: actionRow?.id ?? null,
                        budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
                      })
                    );
                  }
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
                    sseEvent({ done: true, error: "Action may not have been saved." })
                  );
                } catch {
                  // client gone
                }
              }
            }
          } catch (err) {
            console.error("[stream:editor-action] stream error:", err);
            if (!clientDisconnected) {
              try {
                controller.enqueue(
                  sseEvent({ done: true, error: "AI service temporarily unavailable." })
                );
              } catch {
                // client gone
              }
            }
          } finally {
            // Keep the stream (and the isolate) alive until everything above —
            // including persistence — has finished. §7 load-bearing.
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
      messages: llmMessages as any,
      max_tokens: editorMaxTokens,
      temperature,
      thinking,
      effort,
      mistral_effort: mistralEffort,
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error("LLM API error:", llmRes.status, errText);
      return jsonResponse(
        { error: extractProviderError(provider, llmRes.status, errText) },
        502
      );
    }

    const llmData = await llmRes.json();
    // Provider-agnostic parse via the router's normaliser (replaces a
    // hand-rolled provider branch that duplicated the same logic).
    const norm = normaliseResponse(provider, llmData);
    const proposedText = norm.text || fallbackReplyText(norm.stopReason);

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

    // Service-role write (user write policies dropped — write-surface
    // lockdown); project ownership was verified at request entry.
    const { data: actionRow, error: actionErr } = await adminSupabase
      .from("ai_editor_actions")
      .insert({
        project_id: projectId,
        action_type: actionType,
        selected_text_preview: sliceSafe(selectedText, 500),
        ai_response_preview: sliceSafe(proposedText, 500),
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
    const { error: usageErr } = await supabase.from("token_usage").insert({
      user_id: user.id,
      project_id: projectId,
      function_name: "editor-action",
      model_used: chatModel,
      input_tokens: Math.ceil(inputChars / 4),
      output_tokens: Math.ceil(outputChars / 4),
    });
    if (usageErr) console.error("[editor-action] token_usage insert failed:", JSON.stringify(usageErr));

    // --- Update budget ---
    const newTotal = profile.tokens_used_this_period + estimatedTokens;
    const { error: rpcErr } = await adminSupabase.rpc("increment_tokens_used", {
      user_uuid: user.id,
      amount: estimatedTokens,
    });
    if (rpcErr) console.error("[editor-action] increment_tokens_used failed:", JSON.stringify(rpcErr));

    return jsonResponse({
      proposed_text: proposedText,
      action_id: actionRow?.id ?? null,
      tokens_used: estimatedTokens,
      budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
    });
  } catch (err) {
    console.error("Editor action error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
