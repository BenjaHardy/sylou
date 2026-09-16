import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import { callLLM, providerFor, normaliseResponse, extractProviderError, cleanLLMContent, type LLMMessage, type LLMTool } from "../_shared/_llm.ts";
import { makeSSEHelpers, readProviderStream, replayTokenBurst } from "../_shared/_sse.ts";
import { buildDocumentTool, buildWebSearchTool } from "../_shared/_tools.ts";
import { CHAT_TEMPERATURE, resolveTemperature } from "../_shared/_temperatures.ts";
import { ALLOWED_MODELS, INPUT_LIMITS, OUTPUT_BUDGETS } from "../_shared/_models.ts";
import { sliceSafe } from "../_shared/_text.ts";
import {
  CHAT_THINKING, CHAT_EFFORT, CHAT_MISTRAL_EFFORT,
  resolveThinking, resolveEffort, resolveMistralEffort, resolveMaxTokens,
} from "../_shared/_thinking.ts";
import {
  buildMemoryInjection,
  fetchConversationMemory,
  maybeRefreshConversationMemory,
} from "../_shared/_conversation_memory.ts";

import { isOverBudget, getBudgetedProfile } from "../_shared/_billing.ts";
import {
  CLASSIC_MODE_SYSTEM_PROMPT,
  CONCISE_MODE_MODIFIER,
  TEMPLATE_PROMPTS,
  TUTOR_MODE_SYSTEM_PROMPT,
} from "../_shared/_prompts.ts";
import { buildDocIndex, buildFavBlock, WEB_SEARCH_PROMPT } from "./context.ts";
import { runToolLoop } from "./tool-loop.ts";
import { persistChatExchange } from "./persist.ts";


// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, POST, OPTIONS");

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
    const threadId: string = body.thread_id;
    const message: string = body.message;
    const conciseMode: boolean = body.concise_mode ?? false;
    const streamRequested: boolean = body.stream === true;
    const webSearchEnabled: boolean = body.web_search_enabled ?? false;
    const requestedModel: string | undefined = body.model;
    // Gate the request override against the registry allowlist; an absent/empty
    // value falls back to the profile preference as before. Without this, any
    // authed caller could route to arbitrary provider models on the operator's
    // key (the shipped client never sends `model`).
    if (requestedModel && !ALLOWED_MODELS.has(requestedModel)) {
      return jsonResponse(
        { error: `Unsupported model: ${sliceSafe(String(requestedModel), 64)}` },
        400,
      );
    }
    const chatModel: string =
      requestedModel || profile.preferred_chat_model || "mistral-medium-3-5";
    const temperature = resolveTemperature(CHAT_TEMPERATURE, chatModel);
    const thinking = resolveThinking(CHAT_THINKING, chatModel);
    const effort = resolveEffort(CHAT_EFFORT, chatModel);
    const mistralEffort = resolveMistralEffort(CHAT_MISTRAL_EFFORT, chatModel);
    const chatMaxTokens = resolveMaxTokens(OUTPUT_BUDGETS.CHAT, chatModel, thinking, mistralEffort !== undefined);
    console.log(
      `[chat] model=${chatModel} provider=${providerFor(chatModel)} source=${
        requestedModel ? "request" : profile.preferred_chat_model ? "profile" : "default"
      }`,
    );


    if (!threadId || !message || typeof message !== "string") {
      return jsonResponse({ error: "thread_id and message are required" }, 400);
    }
    if (message.length > INPUT_LIMITS.CHAT_MESSAGE_CHARS) {
      return jsonResponse(
        { error: `Message is too long (max ${INPUT_LIMITS.CHAT_MESSAGE_CHARS.toLocaleString("en-US")} characters)` },
        400,
      );
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
    let systemPrompt = tutorMode
      ? TUTOR_MODE_SYSTEM_PROMPT
      : CLASSIC_MODE_SYSTEM_PROMPT;

    // --- Append template-specific context ---
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
      systemPrompt += buildDocIndex(nonFavourites);
    }

    // Append full text of FAVOURITE documents — always available, no tool call needed
    if (favourites.length > 0) {
      systemPrompt += buildFavBlock(favourites, hasNonFavDocs);
    }

    // Gate web search on both user toggle AND BRAVE_SEARCH_API_KEY presence.
    // If unconfigured, never advertise the capability to the LLM — an empty
    // result set reads as "the web has nothing" rather than "not configured".
    const braveConfigured = !!Deno.env.get("BRAVE_SEARCH_API_KEY");
    const webSearchActive = webSearchEnabled && braveConfigured;

    // Append web search instructions to system prompt
    if (webSearchActive) {
      systemPrompt += WEB_SEARCH_PROMPT;
    }

    // --- Fetch the 50 most recent messages ---
    // Order descending + limit to get the *newest* 50 (the tail of a long
    // thread), then reverse back to chronological order for the model.
    // Ascending + limit would send the oldest 50 and hide recent context
    // once a thread passes 50 messages. (context-prompt does the same.)
    const { data: recentHistory } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(50);
    const history = (recentHistory ?? []).reverse();

    // conversation-memory: inject the rolling thread summary (if one
    // exists) ahead of the verbatim window. User zone, deliberately never
    // the system prompt — it is condensed USER conversation and must stay
    // exactly as privileged as the raw messages it summarizes. Read via the
    // user-context client so RLS scopes it to the caller's own threads.
    const conversationMemory = await fetchConversationMemory(supabase, threadId);

    // --- Build messages array ---
    const llmMessages: LLMMessage[] = [
      { role: "system", content: systemPrompt },
      ...(conversationMemory
        ? [{
            role: "user" as const,
            content: buildMemoryInjection(conversationMemory.summary_text),
          }]
        : []),
      ...(history ?? []).map((m: { role: string; content: string }): LLMMessage => ({
        role: m.role as LLMMessage["role"],
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
    const tools: LLMTool[] = [];
    if (hasDocuments) tools.push(buildDocumentTool());
    if (webSearchActive) tools.push(buildWebSearchTool());

    // Per-request context for the unified persistence sequence
    // (persist.ts) — shared by all four completion tails. The prompt
    // count inside it is awaited on every path (checkpoint D3a; the
    // countPromptOnce fire-and-forget form and its once-guard are gone —
    // each request runs exactly one tail).
    const persistCtx = {
      admin: adminSupabase,
      threadId,
      projectId: thread.project_id,
      userId: user.id,
      monthlyTokenBudget: profile.monthly_token_budget,
      tokensUsedThisPeriod: profile.tokens_used_this_period,
      chatModel,
      conciseMode,
      tutorMode,
      message,
    };

    // =========================================================
    // STREAMING PATH — with tool-use support
    // =========================================================
    if (streamRequested) {
      console.log("[stream] entering streaming path for thread", threadId, "hasTools:", hasTools);

      const { sseEvent, createSSEResponse } = makeSSEHelpers(corsHeaders);

      // ---- TWO-PASS FLOW when tools exist ----
      if (hasTools) {
        console.log("[stream] tools available, using two-pass flow");

        // LLM Call #1: non-streaming with tools
        const call1Body = {
          model: chatModel,
          messages: llmMessages,
          max_tokens: chatMaxTokens,
          tools,
          tool_choice: "auto" as const,
          temperature,
          thinking,
          effort,
          mistral_effort: mistralEffort,
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
        const toolCalls = norm1.toolCalls;

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
                await replayTokenBurst(responseText, (chunk) => controller.enqueue(sseEvent({ token: chunk })));

                const {
                  insertedUser,
                  insertedAssistant,
                  persistenceFailed,
                  newTotal,
                } = await persistChatExchange(
                  persistCtx,
                  responseText,
                  totalInputChars,
                  totalOutputChars,
                );

                // Failed message writes take the same path a thrown persistence
                // error does — never report success over missing rows.
                if (persistenceFailed) {
                  controller.enqueue(sseEvent({ done: true, error: "Messages may not have been saved." }));
                } else {
                  controller.enqueue(
                    sseEvent({
                      done: true,
                      user_message: insertedUser,
                      assistant_message: insertedAssistant,
                      budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
                    })
                  );
                }

                // conversation-memory: refresh in the tail, after `done` is
                // sent — the user never waits on it, and the stream-first
                // pattern keeps the isolate alive until controller.close().
                // Non-fatal by contract (the helper never throws).
                await maybeRefreshConversationMemory({
                  admin: adminSupabase,
                  threadId,
                  model: chatModel,
                  userId: user.id,
                  overBudget: profile.monthly_token_budget !== null && newTotal >= profile.monthly_token_budget,
                  logTag: "[chat]",
                });
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
              const toolMessages: LLMMessage[] = [
                ...llmMessages,
                norm1.assistantMessage,
              ];

              // Resolve tool calls iteratively (tool-loop.ts); the char
              // counters return as VALUES and must be folded in — numbers
              // cannot mutate across the module boundary.
              const { inputCharsAdded, outputCharsAdded } = await runToolLoop({
                toolMessages,
                toolCalls,
                documentsReferenced,
                webSearchesPerformed,
                emitPhase: (phase) => {
                  try { controller.enqueue(sseEvent({ phase })); } catch { /* */ }
                },
                adminSupabase,
                projectId: thread.project_id,
                chatModel,
                chatMaxTokens,
                tools,
                temperature,
                thinking,
                effort,
                mistralEffort,
              });
              totalInputChars += inputCharsAdded;
              totalOutputChars += outputCharsAdded;

              // LLM Call #2: streaming with tool results (no tools this time)
              console.log("[stream] starting Call #2 streaming");
              const call2Res = await callLLM({
                  model: chatModel,
                  messages: toolMessages,
                  max_tokens: chatMaxTokens,
                  stream: true,
                  temperature,
                  thinking,
                  effort,
                  mistral_effort: mistralEffort,
                });

              if (!call2Res.ok) {
                const errText = await call2Res.text();
                console.error("[stream] Call #2 error:", call2Res.status, errText);
                const msg = extractProviderError(providerFor(chatModel), call2Res.status, errText);
                try { controller.enqueue(sseEvent({ done: true, error: msg })); } catch { /* */ }
                return;
              }

              // Read Call #2 stream and forward tokens
              let fullResponse = await readProviderStream(call2Res, providerFor(chatModel), {
                onToken: (delta) => {
                  try { controller.enqueue(sseEvent({ token: delta })); } catch { /* client gone */ }
                },
              });

              // Clean and persist
              fullResponse = cleanLLMContent(fullResponse);
              totalOutputChars += fullResponse.length;

              const {
                insertedUser,
                insertedAssistant,
                persistenceFailed,
                newTotal,
              } = await persistChatExchange(
                persistCtx,
                fullResponse || "No response generated.",
                totalInputChars,
                totalOutputChars,
                { documentsReferenced, webSearchesPerformed },
              );

              try {
                if (persistenceFailed) {
                  controller.enqueue(sseEvent({ done: true, error: "Messages may not have been saved." }));
                } else {
                  controller.enqueue(
                    sseEvent({
                      done: true,
                      user_message: insertedUser,
                      assistant_message: insertedAssistant,
                      budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
                    })
                  );
                }
              } catch { /* client gone */ }

              // conversation-memory: refresh in the tail, after `done` is
              // sent (see the no-tool path for the full rationale).
              await maybeRefreshConversationMemory({
                admin: adminSupabase,
                threadId,
                model: chatModel,
                userId: user.id,
                overBudget: profile.monthly_token_budget !== null && newTotal >= profile.monthly_token_budget,
                logTag: "[chat]",
              });
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
          max_tokens: chatMaxTokens,
          stream: true,
          temperature,
          thinking,
          effort,
          mistral_effort: mistralEffort,
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

          try {
            fullResponse = await readProviderStream(llmRes, providerFor(chatModel), {
              onToken: (delta) => {
                try {
                  controller.enqueue(sseEvent({ token: delta }));
                } catch { /* client gone */ }
              },
            });

            // Persist
            console.log("[stream] flush() started");
            fullResponse = cleanLLMContent(fullResponse);

            const inputChars = llmMessages.reduce(
              (sum, m) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length),
              0
            );
            const outputChars = fullResponse.length;
            const {
              insertedUser,
              insertedAssistant,
              persistenceFailed,
              newTotal,
            } = await persistChatExchange(
              persistCtx,
              fullResponse || "No response generated.",
              inputChars,
              outputChars,
            );

            try {
              if (persistenceFailed) {
                controller.enqueue(sseEvent({ done: true, error: "Messages may not have been saved." }));
              } else {
                controller.enqueue(
                  sseEvent({
                    done: true,
                    user_message: insertedUser,
                    assistant_message: insertedAssistant,
                    budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
                  })
                );
              }
            } catch { /* client gone */ }

            console.log("[stream] flush() completed — persistence done");

            // conversation-memory: refresh in the tail, after `done` is
            // sent (see the tool-offered paths for the full rationale).
            // This is the third of chat's three streaming completions — the
            // no-tools path (no imported documents, web search off) — and
            // the one the original hook pass missed.
            await maybeRefreshConversationMemory({
              admin: adminSupabase,
              threadId,
              model: chatModel,
              userId: user.id,
              overBudget: profile.monthly_token_budget !== null && newTotal >= profile.monthly_token_budget,
              logTag: "[chat]",
            });
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
        max_tokens: chatMaxTokens,
        temperature,
        thinking,
        effort,
        mistral_effort: mistralEffort,
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
    // Provider-agnostic parse via the router's normaliser (the previous
    // OpenAI-shape read returned "No response generated." for every
    // Anthropic response — which was then persisted and billed).
    const norm = normaliseResponse(providerFor(chatModel), llmData);
    const assistantText = cleanLLMContent(norm.text || "No response generated.");

    // --- Persist messages ---
    // --- Estimate tokens & persist (persist.ts) ---
    // Service-role writes (write-surface lockdown); thread ownership was
    // verified at request entry. Disclosed D3 normalization: the prompt
    // count here previously ran on the USER-context client — persist.ts
    // uses the admin client on every path (outcome-identical: the
    // project_stats owner UPDATE policy grants the same write).
    const inputChars = llmMessages.reduce(
      (sum, m) => sum + (typeof m.content === "string" ? m.content.length : JSON.stringify(m.content).length),
      0
    );
    const outputChars = assistantText.length;
    const {
      insertedUser,
      insertedAssistant,
      persistenceFailed,
      estimatedTokens,
      newTotal,
    } = await persistChatExchange(
      persistCtx,
      assistantText,
      inputChars,
      outputChars,
    );

    return jsonResponse({
      reply: assistantText,
      tokens_used: estimatedTokens,
      budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - newTotal,
      user_message: insertedUser,
      assistant_message: insertedAssistant,
      // Same contract as the streaming paths: a failed message write is
      // reported, never presented as success (client shows data.error).
      ...(persistenceFailed ? { error: "Messages may not have been saved." } : {}),
    });
  } catch (err) {
    console.error("Chat function error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
