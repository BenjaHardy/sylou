import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.5";
import {
  callLLM, providerFor, normaliseResponse, extractProviderError, cleanLLMContent, fallbackReplyText,
  isProviderTimeout, isRefusalStop, isTruncatedStop, PROVIDER_TIMEOUT_MESSAGE, type LLMMessage, type LLMTool,
} from "../_shared/_llm.ts";
import { makeSSEHelpers, relayProviderStream, replayTokenBurst } from "../_shared/_sse.ts";
import { buildDocumentTool, buildWebSearchTool } from "../_shared/_tools.ts";
import { finalCall, promptChars, runToolLoop } from "../_shared/_tool_loop.ts";
import { CONTEXT_TEMPERATURE, resolveTemperature } from "../_shared/_temperatures.ts";
import { DEFAULT_CHAT_MODEL, INPUT_LIMITS, OUTPUT_BUDGETS, resolveModel } from "../_shared/_models.ts";
import { sliceSafe } from "../_shared/_text.ts";
import {
  CONTEXT_THINKING, CONTEXT_EFFORT, CONTEXT_MISTRAL_EFFORT, SUMMARY_TABLES,
  resolveReasoning, resolveMaxTokens,
} from "../_shared/_thinking.ts";
import {
  fetchConversationMemory,
  fetchVerbatimWindow,
  maybeRefreshConversationMemory,
} from "../_shared/_conversation_memory.ts";
import { WEB_SEARCH_PROMPT } from "../_shared/_prompts.ts";

import { isOverBudget, getBudgetedProfile } from "../_shared/_billing.ts";
import { persistContextExchange, type PersistCtx } from "./persist.ts";
import { formatCreativeDataForSummary } from "./creative.ts";
import {
  mergeSummary, buildSummaryPrompt, buildResponsePrompt,
  CLASSIC_MODE_SYSTEM_PROMPT, TUTOR_MODE_SYSTEM_PROMPT,
  CONCISE_MODE_MODIFIER, TEMPLATE_PROMPTS,
} from "./prompts.ts";
import { callChatModel } from "./call-model.ts";
import { handleConfirm } from "./confirm.ts";


// Service-role client for ai_editor_actions (bypasses RLS)
function getAdminClient(deps: ClientDeps) {
  const url = deps.env.get("SUPABASE_URL")!;
  const serviceKey = deps.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return deps.createClient(url, serviceKey);
}

// --- CORS allow-list (parsed once at module load) ---
import { makeCorsHeadersFor } from "../_shared/_cors.ts";
import type { ClientDeps, HandlerDeps } from "../_shared/_handler.ts";

const corsHeadersFor = makeCorsHeadersFor("GET, POST, OPTIONS");

// ── Main handler ────────────────────────────────────────────────────────────

const defaultDeps: HandlerDeps = { env: Deno.env, createClient, callLLM };

export const handler = async (req: Request, deps = defaultDeps): Promise<Response> => {
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

    const supabaseUrl = deps.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = deps.env.get("SUPABASE_ANON_KEY")!;
    const supabase = deps.createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // --- Token budget + preferred chat model ---
    const { profile, profileErr } = await getBudgetedProfile(supabase, user.id);

    if (profileErr || !profile) {
      return jsonResponse({ error: "Profile not found" }, 404);
    }

    // Past the auth/profile guards above, user & profile are non-null. Capture
    // them here so nested closures (the streaming tails' conversation-memory
    // refresh) keep the narrowed types — TS doesn't propagate outer narrowing
    // into inner function scopes. persistCtx below also reads these.
    const authedUser = user;
    const authedProfile = profile;

    if (isOverBudget(profile)) {
      return jsonResponse({ error: "Monthly token budget exceeded" }, 403);
    }

    // Resolve chat model (request override allowed); validate provider key exists.
    const modelChoice = resolveModel(
      (await req.clone().json().catch(() => ({})))?.model,
      profile.preferred_chat_model,
      DEFAULT_CHAT_MODEL,
    );
    if ("error" in modelChoice) {
      return jsonResponse({ error: modelChoice.error }, 400);
    }
    const chatModel = modelChoice.model;
    const provider = providerFor(chatModel);
    const temperature = resolveTemperature(CONTEXT_TEMPERATURE, chatModel);
    // Reply call (#2): the user's reasoning level, else the context defaults.
    const { thinking, effort, mistralEffort } = resolveReasoning(chatModel, profile.preferred_chat_reasoning, {
      thinking: CONTEXT_THINKING, effort: CONTEXT_EFFORT, mistral: CONTEXT_MISTRAL_EFFORT,
    });
    const contextMaxTokens = resolveMaxTokens(OUTPUT_BUDGETS.CONTEXT_RESPONSE, chatModel, thinking, mistralEffort !== undefined);
    // Writing-summary call (#1) keeps fixed settings whatever the user picked:
    // it runs before the stream starts (the hosted idle limit is counting)
    // and is a delta summary, not a reply.
    const summary = resolveReasoning(chatModel, undefined, SUMMARY_TABLES);
    const summaryMaxTokens = resolveMaxTokens(OUTPUT_BUDGETS.CONTEXT_SUMMARY, chatModel, summary.thinking, summary.mistralEffort !== undefined);
    const providerKeyEnv = provider === "anthropic" ? "ANTHROPIC_API_KEY" : provider === "deepseek" ? "DEEPSEEK_API_KEY" : "MISTRAL_API_KEY";
    if (!deps.env.get(providerKeyEnv)) {
      return jsonResponse({ error: `${provider} API key not configured` }, 500);
    }

    // --- Parse body ---
    const body = await req.json();
    const { project_id, thread_id, action_type, selected_text, instruction, source_module } = body;
    const selectedTextSource: string | undefined = body.selected_text_source;
    const webSearchEnabled: boolean = body.web_search_enabled ?? false;

    // ── CONFIRM endpoint ────────────────────────────────────────────────
    // Ordering invariant: this call sits AFTER the budget/allowlist/key
    // gates and BEFORE field validation — CONFIRM requests deliberately
    // inherit those three rejections. Branch body lives in confirm.ts.
    if (body.confirm !== undefined) {
      return await handleConfirm({
        body,
        supabase,
        admin: getAdminClient(deps),
        projectId: project_id,
        jsonResponse,
      });
    }

    // ── Main context-prompt flow ────────────────────────────────────────
    if (!project_id || !thread_id || !action_type || !selected_text || !instruction || !source_module) {
      return jsonResponse(
        { error: "project_id, thread_id, action_type, selected_text, instruction, and source_module are required" },
        400,
      );
    }
    if (body.stream !== true) {
      return jsonResponse({ error: "Only streaming requests are supported (send stream: true)" }, 400);
    }
    if (typeof selected_text !== "string" || selected_text.length > INPUT_LIMITS.SELECTED_TEXT_CHARS) {
      return jsonResponse(
        { error: `Selection is too long (max ${INPUT_LIMITS.SELECTED_TEXT_CHARS.toLocaleString("en-US")} characters)` },
        400,
      );
    }
    if (typeof instruction !== "string" || instruction.length > INPUT_LIMITS.INSTRUCTION_CHARS) {
      return jsonResponse(
        { error: `Instruction is too long (max ${INPUT_LIMITS.INSTRUCTION_CHARS.toLocaleString("en-US")} characters)` },
        400,
      );
    }
    if (selectedTextSource !== undefined && (typeof selectedTextSource !== "string" || selectedTextSource.length > INPUT_LIMITS.SHORT_FIELD_CHARS)) {
      return jsonResponse({ error: "Invalid selected_text_source" }, 400);
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

    // --- Verify the target thread belongs to this project (fail-closed) ---
    // The service-role persistence writes key on thread_id, so it must be
    // ownership-gated like project_id is above — without this, a foreign
    // thread UUID in the body would let the admin-client inserts land
    // Ask/Propose rows (FLOW-input signals) in another user's thread.
    // RLS on chat_threads returns null for threads the caller can't see,
    // and the project_id predicate pins the thread to THIS project
    // (mirrors chat's gate). CONFIRM returns before this and is unaffected.
    const { data: targetThread } = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", thread_id)
      .eq("project_id", project_id)
      .maybeSingle();
    if (!targetThread) {
      return jsonResponse({ error: "Thread not found or not owned by user" }, 404);
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

    // --- 3. Conversation memory + the verbatim window of the active thread ---
    // Read via the user-context client so RLS scopes both to the caller's
    // own threads. The memory renders next to RECENT CHAT HISTORY inside the
    // same context container that carries the raw messages — identical
    // relative privilege.
    const conversationMemory = await fetchConversationMemory(supabase, thread_id);
    const recentChat = await fetchVerbatimWindow(supabase, thread_id, conversationMemory);

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

    const summaryResult = await callChatModel(chatModel, summaryMessages, summaryMaxTokens, temperature, summary.thinking, summary.effort, summary.mistralEffort, deps.callLLM);
    const summaryText = summaryResult.text.trim();

    // --- 5. Determine summary update (protocol + merge live in prompts.ts) ---
    const { updatedSummary, summaryUpdate } = mergeSummary(summaryText, existingSummary);

    // --- 6. Build LLM Call #2 prompt ---
    const tutorMode = project.tutor_mode ?? false;
    const conciseMode = body.concise_mode ?? false;

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
    const adminClient = getAdminClient(deps);

    const { data: importedDocs } = await adminClient
      .from("imported_documents")
      .select("id, file_name, summary, extracted_text, is_favourite")
      .eq("project_id", project_id);

    const allDocs = importedDocs ?? [];
    const favourites = allDocs.filter((d: any) => d.is_favourite && d.extracted_text);
    const nonFavourites = allDocs.filter((d: any) => !d.is_favourite);
    const hasNonFavDocs = nonFavourites.length > 0;
    const hasDocuments = hasNonFavDocs; // controls doc tool registration

    // Append document index to system prompt for NON-favourites only
    if (hasNonFavDocs) {
      let docIndex = `\n\n# IMPORTED DOCUMENTS\n\nThe user has imported the following reference documents into this project. You can see their titles and summaries below. If you need the full text of any document to answer the user's question or fulfill their request, use the read_imported_document tool. Only retrieve documents that are directly relevant.\n\n`;
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

    // Gate web search on both the user toggle AND BRAVE_SEARCH_API_KEY presence
    // (mirrors chat/). Without a server-side key the tool can't work, so don't
    // register it or advertise it to the model.
    const braveConfigured = !!deps.env.get("BRAVE_SEARCH_API_KEY");
    const webSearchActive = webSearchEnabled && braveConfigured;

    // Append web search instructions to system prompt
    if (webSearchActive) {
      systemPrompt += WEB_SEARCH_PROMPT;
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
      conversationMemory?.summary_text ?? null,
    );

    // Track totals across all calls
    let totalInputChars = summaryResult.inputChars;
    let totalOutputChars = summaryResult.outputChars;
    const documentsReferenced: string[] = [];
    const webSearchesPerformed: string[] = [];

    // Per-request persistence context (persist.ts) — built once, before the
    // stream/no-stream split; every field is stable by this point. The
    // mutating char totals deliberately stay OUT: they are passed to
    // persistContextExchange as call-time finals. The two arrays are safe
    // by reference (const, populated by the tool loops before any
    // persistence call fires).
    const persistCtx: PersistCtx = {
      admin: adminClient,
      userClient: supabase,
      userId: authedUser.id,
      monthlyTokenBudget: authedProfile.monthly_token_budget,
      tokensUsedThisPeriod: authedProfile.tokens_used_this_period,
      projectId: project_id,
      threadId: thread_id,
      actionType: action_type,
      selectedText: selected_text,
      instruction,
      selectedTextSource,
      chatModel,
      conciseMode,
      tutorMode,
      summaryUpdate,
      updatedSummary,
      summaryRow: summaryRow ?? null,
      documentsReferenced,
      webSearchesPerformed,
    };

    // --- Build tools array ---
    const hasTools = hasDocuments || webSearchActive;
    // LLMTool[] since seam 2b: the shared builders are precisely typed, and
    // the previous Record<string, unknown>[] annotation can't hold them.
    // Type-level only — erased at compile time.
    const tools: LLMTool[] = [];
    if (hasDocuments) tools.push(buildDocumentTool());
    if (webSearchActive) tools.push(buildWebSearchTool());

    // All LLM calls (tool-bearing and not) go through callLLM, which handles
    // provider routing + body translation. normaliseResponse uniformly extracts
    // tool calls and the assistant message regardless of provider.

    // =========================================================
    // STREAMING PATH — LLM Call #2 with optional tool-use
    // =========================================================
    console.log("[stream:context-prompt] entering streaming path, action_type:", action_type, "hasTools:", hasTools);

    const { sseEvent, createSSEResponse, keepAlive } = makeSSEHelpers(corsHeaders);

    // The `done` event of a persisted exchange: the reply with its stop
    // flags, the rows and the remaining budget, or the persistence warning.
    type PersistResult = Awaited<ReturnType<typeof persistContextExchange>>;
    const doneEvent = (aiResponse: string, stopReason: string | null, r: PersistResult) =>
      sseEvent(
        r.persistenceFailed
          ? { done: true, error: "Messages may not have been saved." }
          : {
            done: true,
            ai_response: aiResponse,
            truncated: isTruncatedStop(stopReason),
            refused: isRefusalStop(stopReason),
            summary_update: summaryUpdate,
            action_id: r.actionRow?.id ?? null,
            budget_remaining: r.budgetRemaining,
            inserted_messages: r.insertedMessages,
            ...(documentsReferenced.length > 0 ? { documents_referenced: documentsReferenced } : {}),
            ...(webSearchesPerformed.length > 0 ? { web_searches_performed: webSearchesPerformed } : {}),
          },
      );

    // ── TWO-PASS FLOW when tools exist ──
    // Move entire Call #2a inside ReadableStream so phase events stream immediately
    if (hasTools) {
      console.log("[stream:context-prompt] tools available, two-pass flow (stream-first)");

      const readable = new ReadableStream({
        async start(controller) {
          const stopKeepalive = keepAlive(controller);
          try {
            // Emit initial phase so the client knows we're working
            controller.enqueue(sseEvent({ phase: "reviewing" }));

            // Call #2a: non-streamed with tools (provider-aware via callLLM)
            const call2aRes = await deps.callLLM({
              model: chatModel,
              messages: responseMessages as any,
              max_tokens: contextMaxTokens,
              tools: tools as any,
              temperature,
              thinking,
              effort,
              mistral_effort: mistralEffort,
            });

            if (!call2aRes.ok) {
              const errText = await call2aRes.text();
              console.error("[stream:context-prompt] Call #2a error:", call2aRes.status, errText);
              controller.enqueue(sseEvent({ error: extractProviderError(providerFor(chatModel), call2aRes.status, errText) }));
              return;
            }

            const call2aData = await call2aRes.json();
            const norm2a = normaliseResponse(providerFor(chatModel), call2aData);
            const toolCalls = norm2a.toolCalls;
            const call2aContent = cleanLLMContent(norm2a.text);
            const call2aInputChars = responseMessages.reduce((s, m) => s + m.content.length, 0);
            totalInputChars += call2aInputChars;
            totalOutputChars += call2aContent.length;

            if (toolCalls.length === 0) {
              // No tool use — emit Call #2a text as rapid SSE tokens
              console.log("[stream:context-prompt] no tool use, emitting Call #2a directly");
              const responseText = call2aContent || fallbackReplyText(norm2a.stopReason);

              controller.enqueue(sseEvent({ phase: "responding" }));

              await replayTokenBurst(responseText, (chunk) => controller.enqueue(sseEvent({ token: chunk })));

              const persisted = await persistContextExchange(persistCtx, responseText, totalInputChars, totalOutputChars);
              controller.enqueue(doneEvent(responseText, norm2a.stopReason, persisted));
            } else {
              // ── Tool use detected ──
              console.log("[stream:context-prompt] tool use detected:", toolCalls.length, "calls");

              // Tool messages stay in OpenAI shape; toAnthropicBody in _llm.ts
              // translates `role:"tool"` and assistant `tool_calls` to Anthropic's
              // tool_result / tool_use content blocks transparently.
              const toolMessages: LLMMessage[] = [
                ...(responseMessages as LLMMessage[]),
                norm2a.assistantMessage,
              ];

              // Resolve tool calls iteratively (_shared/_tool_loop.ts); the
              // char counters return as values and must be folded in.
              const { inputCharsAdded, outputCharsAdded } = await runToolLoop({
                toolMessages,
                toolCalls,
                documentsReferenced,
                webSearchesPerformed,
                emitPhase: (phase) => {
                  try { controller.enqueue(sseEvent({ phase })); } catch { /* */ }
                },
                adminSupabase: adminClient,
                projectId: project_id,
                chatModel,
                chatMaxTokens: contextMaxTokens,
                tools,
                temperature,
                thinking,
                effort,
                mistralEffort,
                logTag: "[stream:context-prompt]",
                llm: deps.callLLM,
              });
              totalInputChars += inputCharsAdded;
              totalOutputChars += outputCharsAdded;

              // Call #2b: streaming with tool results; no tool calls allowed
              console.log("[stream:context-prompt] starting Call #2b streaming");
              const final = finalCall(chatModel, tools, toolMessages);
              const call2bRes = await deps.callLLM({
                model: chatModel,
                ...final,
                max_tokens: contextMaxTokens,
                stream: true,
                temperature,
                thinking,
                effort,
                mistral_effort: mistralEffort,
              });

              if (!call2bRes.ok) {
                const errText = await call2bRes.text();
                console.error("[stream:context-prompt] Call #2b error:", call2bRes.status, errText);
                controller.enqueue(sseEvent({ done: true, error: extractProviderError(providerFor(chatModel), call2bRes.status, errText) }));
                return;
              }
              totalInputChars += promptChars(final.messages);

              // Read Call #2b stream and forward tokens
              const call2b = await relayProviderStream(call2bRes, providerFor(chatModel), controller, sseEvent);

              // Clean and persist
              const fullResponse = cleanLLMContent(call2b.text);
              if (!fullResponse.trim()) {
                console.warn("[stream:context-prompt] Call #2b returned no text", { stop_reason: call2b.stopReason, ...call2b.stats });
              }
              const aiResponse = fullResponse.trim() || fallbackReplyText(call2b.stopReason);
              const persisted = await persistContextExchange(persistCtx, aiResponse, totalInputChars, totalOutputChars + aiResponse.length);
              try {
                controller.enqueue(doneEvent(aiResponse, call2b.stopReason, persisted));
              } catch { /* client gone */ }
            }
          } catch (err) {
            console.error("[stream:context-prompt] error in tool-use path:", err);
            const msg = isProviderTimeout(err)
              ? PROVIDER_TIMEOUT_MESSAGE
              : err instanceof Error && err.message ? sliceSafe(err.message, 200) : "AI service temporarily unavailable.";
            try { controller.enqueue(sseEvent({ done: true, error: msg })); } catch { /* */ }
          } finally {
            // conversation-memory: refresh in the tail, after `done` —
            // Ask/Propose exchanges land in the thread too, so this
            // function crosses the boundary as well. Non-fatal; no-ops
            // cheaply when fewer than the threshold are uncovered.
            await maybeRefreshConversationMemory({
              admin: adminClient,
              threadId: thread_id,
              model: chatModel,
              userId: authedUser.id,
              overBudget: authedProfile.monthly_token_budget !== null &&
                authedProfile.tokens_used_this_period >= authedProfile.monthly_token_budget,
              logTag: "[context-prompt]",
              llm: deps.callLLM,
            });
            stopKeepalive();
            controller.close();
          }
        },
      });

      return createSSEResponse(readable);
    }
    // ── NO TOOLS — streaming Call #2 using ReadableStream ──
    console.log("[stream:context-prompt] no tools, standard streaming");

    const llmRes = await deps.callLLM({
      model: chatModel,
      messages: responseMessages as any,
      max_tokens: contextMaxTokens,
      stream: true,
      temperature,
      thinking,
      effort,
      mistral_effort: mistralEffort,
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text();
      console.error("[stream:context-prompt] LLM API error:", llmRes.status, errText);
      return jsonResponse(
        { error: extractProviderError(providerFor(chatModel), llmRes.status, errText) },
        502
      );
    }

    const readable = new ReadableStream({
      async start(controller) {
        const stopKeepalive = keepAlive(controller);

        try {
          controller.enqueue(sseEvent({ phase: "responding" }));

          const relay = await relayProviderStream(llmRes, providerFor(chatModel), controller, sseEvent);

          console.log("[stream:context-prompt] LLM stream complete, persisting");
          const fullResponse = cleanLLMContent(relay.text);
          if (!fullResponse.trim()) {
            console.warn("[stream:context-prompt] reply returned no text", { stop_reason: relay.stopReason, ...relay.stats });
          }
          const aiResponse = fullResponse.trim() || fallbackReplyText(relay.stopReason);
          const extraInputChars = responseMessages.reduce((s, m) => s + m.content.length, 0);
          const persisted = await persistContextExchange(persistCtx, aiResponse, totalInputChars + extraInputChars, totalOutputChars + aiResponse.length);
          try {
            controller.enqueue(doneEvent(aiResponse, relay.stopReason, persisted));
          } catch { /* client gone */ }

          console.log("[stream:context-prompt] persistence complete");
        } catch (persistErr) {
          console.error("[stream:context-prompt] persistence error:", persistErr);
          try {
            controller.enqueue(sseEvent({ done: true, error: "Action may not have been saved." }));
          } catch { /* client gone */ }
        } finally {
          // conversation-memory: refresh in the tail (see tool-use path).
          await maybeRefreshConversationMemory({
            admin: adminClient,
            threadId: thread_id,
            model: chatModel,
            userId: authedUser.id,
            overBudget: authedProfile.monthly_token_budget !== null &&
              authedProfile.tokens_used_this_period >= authedProfile.monthly_token_budget,
            logTag: "[context-prompt]",
            llm: deps.callLLM,
          });
          stopKeepalive();
          controller.close();
        }
      },
    });

    return createSSEResponse(readable);
  } catch (err) {
    console.error("Context-prompt error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
};

Deno.serve((req) => handler(req));
