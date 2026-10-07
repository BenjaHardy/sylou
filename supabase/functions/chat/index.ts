import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import {
  callLLM, providerFor, normaliseResponse, extractProviderError, cleanLLMContent, fallbackReplyText,
  isProviderTimeout, PROVIDER_TIMEOUT_MESSAGE, type LLMMessage, type LLMTool,
} from "../_shared/_llm.ts";
import { makeSSEHelpers, relayProviderStream, replayTokenBurst } from "../_shared/_sse.ts";
import { buildDocumentTool, buildWebSearchTool } from "../_shared/_tools.ts";
import { CHAT_TEMPERATURE, resolveTemperature } from "../_shared/_temperatures.ts";
import { ALLOWED_MODELS, INPUT_LIMITS, OUTPUT_BUDGETS } from "../_shared/_models.ts";
import { sliceSafe } from "../_shared/_text.ts";
import {
  CHAT_THINKING, CHAT_EFFORT, CHAT_MISTRAL_EFFORT,
  resolveReasoning, resolveMaxTokens,
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
  WEB_SEARCH_PROMPT,
} from "../_shared/_prompts.ts";
import { buildDocIndex, buildFavBlock } from "./context.ts";
import { finalCall, promptChars, runToolLoop } from "../_shared/_tool_loop.ts";
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
    if (body.stream !== true) {
      return jsonResponse({ error: "Only streaming requests are supported (send stream: true)" }, 400);
    }
    const chatModel: string =
      requestedModel || profile.preferred_chat_model || "zai-glm-5-3";
    const temperature = resolveTemperature(CHAT_TEMPERATURE, chatModel);
    const reasoning = resolveReasoning(chatModel, profile.preferred_chat_reasoning, {
      thinking: CHAT_THINKING, effort: CHAT_EFFORT, mistral: CHAT_MISTRAL_EFFORT,
    });
    const { thinking, effort, mistralEffort } = reasoning;
    const chatMaxTokens = resolveMaxTokens(OUTPUT_BUDGETS.CHAT, chatModel, thinking, mistralEffort !== undefined);
    console.log(
      `[chat] model=${chatModel} provider=${providerFor(chatModel)} source=${
        requestedModel ? "request" : profile.preferred_chat_model ? "profile" : "default"
      } reasoning=${reasoning.optionId ?? "fixed"}${reasoning.userChosen ? " (user)" : ""}`,
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
    console.log("[stream] entering streaming path for thread", threadId, "hasTools:", hasTools);

    const { sseEvent, createSSEResponse, keepAlive } = makeSSEHelpers(corsHeaders);

    // The `done` event of a persisted exchange: the rows and the remaining
    // budget, or the persistence warning.
    type PersistResult = Awaited<ReturnType<typeof persistChatExchange>>;
    const doneEvent = (r: Pick<PersistResult, "insertedUser" | "insertedAssistant" | "persistenceFailed" | "newTotal">) =>
      sseEvent(
        r.persistenceFailed
          ? { done: true, error: "Messages may not have been saved." }
          : {
            done: true,
            user_message: r.insertedUser,
            assistant_message: r.insertedAssistant,
            budget_remaining: profile.monthly_token_budget === null ? null : profile.monthly_token_budget - r.newTotal,
          },
      );

    // A provider timeout is a reply like the other failure notices
    // (refusals, empty replies): the exchange is persisted with the notice
    // as the assistant message, so it survives a thread switch or a reload,
    // and `done` carries the rows. The transient error event remains the
    // fallback when that write throws. Every provider shares callLLM's
    // timeout, so this is model-agnostic.
    const finishWithTimeoutNotice = async (controller: ReadableStreamDefaultController, inputChars: number) => {
      const event = await persistChatExchange(
        persistCtx, PROVIDER_TIMEOUT_MESSAGE, inputChars, 0, { documentsReferenced, webSearchesPerformed },
      ).then(doneEvent, (err) => {
        console.error("[stream] timeout notice not persisted:", err);
        return sseEvent({ done: true, error: PROVIDER_TIMEOUT_MESSAGE });
      });
      try { controller.enqueue(event); } catch { /* client gone */ }
    };

    // The response when a call timed out before any stream existed: a
    // stream whose only event is the persisted notice.
    const timeoutNoticeResponse = (inputChars: number) =>
      createSSEResponse(new ReadableStream({
        async start(controller) {
          try { await finishWithTimeoutNotice(controller, inputChars); } finally { controller.close(); }
        },
      }));

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


      let call1Res: Response;
      try {
        call1Res = await callLLM(call1Body);
      } catch (err) {
        if (!isProviderTimeout(err)) throw err;
        console.error("[stream] Call #1 timed out");
        return timeoutNoticeResponse(promptChars(llmMessages));
      }

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
        if (!call1Content.trim()) {
          // Non-streamed, so no StreamStats: the finish reason and usage are
          // what tells a budget cut from a provider turn that ended empty.
          console.warn("[stream] Call #1 returned no text and no tool call", {
            stop_reason: norm1.stopReason,
            stop_details: norm1.stopDetails,
            usage: norm1.usage ?? null,
          });
        }
        const responseText = call1Content || fallbackReplyText(norm1.stopReason);

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
              controller.enqueue(doneEvent({ insertedUser, insertedAssistant, persistenceFailed, newTotal }));

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

      // The conversation with tool results; grows by reference in the loop.
      const toolMessages: LLMMessage[] = [...llmMessages, norm1.assistantMessage];

      const readable = new ReadableStream({
        async start(controller) {
          const stopKeepalive = keepAlive(controller);
          try {
            // Resolve tool calls iteratively (_shared/_tool_loop.ts); the char
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
              logTag: "[stream]",
            });
            totalInputChars += inputCharsAdded;
            totalOutputChars += outputCharsAdded;

            // LLM Call #2: streaming with tool results; no tool calls allowed
            console.log("[stream] starting Call #2 streaming");
            const final = finalCall(chatModel, tools, toolMessages);
            const call2Res = await callLLM({
                model: chatModel,
                ...final,
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
            totalInputChars += promptChars(final.messages);

            // Read Call #2 stream and forward tokens
            const call2 = await relayProviderStream(call2Res, providerFor(chatModel), controller, sseEvent);

            // Clean and persist
            const fullResponse = cleanLLMContent(call2.text);
            if (!fullResponse.trim()) {
              console.warn("[stream] Call #2 returned no text", { stop_reason: call2.stopReason, ...call2.stats });
            }
            totalOutputChars += fullResponse.length;

            const {
              insertedUser,
              insertedAssistant,
              persistenceFailed,
              newTotal,
            } = await persistChatExchange(
              persistCtx,
              fullResponse || fallbackReplyText(call2.stopReason),
              totalInputChars,
              totalOutputChars,
              { documentsReferenced, webSearchesPerformed },
            );

            try {
              controller.enqueue(doneEvent({ insertedUser, insertedAssistant, persistenceFailed, newTotal }));
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
            if (isProviderTimeout(err)) {
              // Bills the timed-out call's prompt on top of the completed
              // ones; on a loop timeout the check calls that completed
              // before it are lost with the throw (the loop returns its
              // counters by value).
              await finishWithTimeoutNotice(controller, totalInputChars + promptChars(toolMessages));
            } else {
              try {
                controller.enqueue(sseEvent({ done: true, error: "AI service temporarily unavailable." }));
              } catch { /* client gone */ }
            }
          } finally {
            stopKeepalive();
            controller.close();
          }
        },
      });

      return createSSEResponse(readable);
    }
    // ---- NO TOOLS — streaming path using ReadableStream ----
    console.log("[stream] no tools, standard streaming path");

    let llmRes: Response;
    try {
      llmRes = await callLLM({
        model: chatModel,
        messages: llmMessages,
        max_tokens: chatMaxTokens,
        stream: true,
        temperature,
        thinking,
        effort,
        mistral_effort: mistralEffort,
      });
    } catch (err) {
      // A streamed call times out only before its first byte.
      if (!isProviderTimeout(err)) throw err;
      console.error("[stream] no-tools call timed out");
      return timeoutNoticeResponse(promptChars(llmMessages));
    }

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
        const stopKeepalive = keepAlive(controller);

        try {
          const relay = await relayProviderStream(llmRes, providerFor(chatModel), controller, sseEvent);

          // Persist
          console.log("[stream] flush() started");
          const fullResponse = cleanLLMContent(relay.text);
          if (!fullResponse.trim()) {
            console.warn("[stream] reply returned no text", { stop_reason: relay.stopReason, ...relay.stats });
          }

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
            fullResponse || fallbackReplyText(relay.stopReason),
            inputChars,
            outputChars,
          );

          try {
            controller.enqueue(doneEvent({ insertedUser, insertedAssistant, persistenceFailed, newTotal }));
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
          stopKeepalive();
          controller.close();
        }
      },
    });

    return createSSEResponse(readable);
  } catch (err) {
    console.error("Chat function error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
