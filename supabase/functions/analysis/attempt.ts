// analysis/attempt.ts — the FLOW LLM attempt machinery (P4-1 Phase D
// split). NOT a byte-pure move: attemptFlowCall and billFailedAttempt
// were request-scoped closures in index.ts, lifted here with their
// captures made explicit params (the confirm.ts / persist.ts precedent).
// Bodies are otherwise verbatim — dedented, hashes in the commit msg.
//
// Contract notes:
// - The retry (attempt 2) rebuilds messages from the RAW prompts and
//   appends the nudge — it does not reuse baseLlmArgs.messages.
// - Refusal and max_tokens ("length") failures set noRetry on both the
//   Structured Outputs and the tool-calling path: retrying a deterministic
//   failure would only burn tokens and mask the signal (P3-7c).
// - AttemptOk returns flowResult/repairedPillars BY REFERENCE on
//   purpose: index.ts mutates both afterwards (pillar defaulting, score
//   coercion pushed into repairedPillars) and the flow_meta disclosure
//   depends on it. Never defensively copy here.
// - isValidPillar below is the single lifted copy of what were two
//   identical request-scoped declarations; it is deliberately DISTINCT
//   from _repair.ts's isPillarObject (which also requires "score").

import {
  callLLM,
  normaliseResponse,
  extractProviderError,
  isTruncatedStop,
  StructuredOutputError,
  STRUCTURED_OUTPUT_REFUSAL,
  STRUCTURED_OUTPUT_MAX_TOKENS,
  type ProviderId,
} from "../_shared/_llm.ts";
import { repairToolOutput } from "../_shared/_repair.ts";
import { contentLogsEnabled } from "../_shared/_debug.ts";
import { SUBMIT_FLOW_TOOL } from "./prompts.ts";

/** Pillar-shape validator (reasoning + evidence[] + narrative; the score
 *  field is validated separately by index.ts's normalization pass). */
export function isValidPillar(p: unknown): boolean {
  return (
    typeof p === "object" && p !== null &&
    "reasoning" in p && "evidence" in p &&
    Array.isArray((p as Record<string, unknown>).evidence) && "narrative" in p
  );
}

// ============================================================
// WORKAROUND (see _repair.ts): Claude's tool_use output is
// occasionally malformed (stringified-JSON pillars or schema
// drift). We (1) repair stringified pillars in-place, then
// (2) on validation failure, retry the call ONCE with a small
// prompt nudge to shift Claude's sampling path. Repair alone
// does NOT trigger a retry — retry only fires when validation
// still fails after repair.
// Remove or simplify this block if Anthropic stabilizes
// tool_use output and the [FLOW repair]/[FLOW retry] log lines
// stop appearing in production.
// ============================================================
export type AttemptOk = {
  ok: true;
  flowResult: Record<string, unknown>;
  /** Pillar keys the repair layer re-parsed — disclosed in flow_meta. */
  repairedPillars: string[];
  usage: { input_tokens?: number; output_tokens?: number };
};
export type AttemptFail = {
  ok: false;
  errorResponse: Response;
  usage: { input_tokens?: number; output_tokens?: number };
  noRetry?: boolean;
  /** token_usage.function_name for billing this failure (defaults to
   *  "analysis:schema_invalid" on the retry funnel). */
  failureLabel?: string;
};

/** Everything attemptFlowCall used to close over, made explicit.
 *  jsonResponse MUST be the handler's own closure (it carries the
 *  per-request CORS headers) — never a rebuilt equivalent. */
export interface AttemptDeps {
  /** Resolved request args; the retry spreads these and rebuilds only
   *  the messages array from the two raw prompts below. */
  baseLlmArgs: Parameters<typeof callLLM>[0];
  systemPromptTemplate: string;
  userPrompt: string;
  flowModel: string;
  provider: ProviderId;
  temperature: number | undefined;
  useStructuredOutputs: boolean;
  /** Operator-log context only (structured-output error logging). */
  projectId: string;
  jsonResponse: (body: Record<string, unknown>, status?: number) => Response;
  /** Test seam (the _tool_loop.ts pattern); production leaves it unset. */
  llm?: typeof callLLM;
}

export async function attemptFlowCall(
  attempt: 1 | 2,
  deps: AttemptDeps,
): Promise<AttemptOk | AttemptFail> {
  const {
    baseLlmArgs, systemPromptTemplate, userPrompt, flowModel, provider,
    temperature, useStructuredOutputs, projectId, jsonResponse,
  } = deps;
  const llmArgs = attempt === 1
    ? baseLlmArgs
    : {
        ...baseLlmArgs,
        messages: [
          { role: "system" as const, content: systemPromptTemplate },
          {
            role: "user" as const,
            content:
              userPrompt +
              "\n\nPlease ensure each pillar (find, lead, organize, write) is returned as a nested JSON object, not as a stringified JSON value.",
          },
        ],
      };

  const requestBody = JSON.stringify(llmArgs);
  console.log("FLOW prompt sent", {
    model: flowModel,
    provider,
    attempt,
    temperature,
    request_chars: requestBody.length,
    ...(contentLogsEnabled() ? { request_body: requestBody } : {}),
  });

  const llmRes = await (deps.llm ?? callLLM)(llmArgs);

  if (!llmRes.ok) {
    const errText = await llmRes.text();
    console.error("LLM API error:", llmRes.status, errText);
    return {
      ok: false,
      usage: {},
      errorResponse: jsonResponse(
        { error: extractProviderError(provider, llmRes.status, errText) },
        502,
      ),
    };
  }

  const rawData = await llmRes.json();
  const rawResponse = JSON.stringify(rawData);
  const stopReason: string | null =
    rawData?.stop_reason ?? rawData?.choices?.[0]?.finish_reason ?? null;

  console.log("FLOW raw response", {
    model: flowModel,
    attempt,
    temperature,
    stop_reason: stopReason,
    response_chars: rawResponse.length,
    ...(contentLogsEnabled() ? { raw_response: rawResponse } : {}),
  });

  // A reply cut at max_tokens is deterministic at temperature 0 (a model
  // that spent the ceiling thinking will spend it again): no retry, so a
  // FLOW request stays one long attempt, inside the hosted request limit.
  const truncatedFailure = (usage: AttemptFail["usage"]): AttemptFail => ({
    ok: false,
    usage,
    noRetry: true,
    failureLabel: "analysis:max_tokens",
    errorResponse: jsonResponse(
      { error: "Analysis output was truncated. Please try again or use a smaller project." },
      502,
    ),
  });

  let normalised;
  try {
    normalised = normaliseResponse(
      provider,
      rawData,
      useStructuredOutputs
        ? { structuredOutputName: SUBMIT_FLOW_TOOL.name }
        : undefined,
    );
  } catch (e) {
    if (e instanceof StructuredOutputError) {
      // The message can quote model output (JSON parse errors), so it is
      // logged with the raw response only when content logs are on.
      console.error("[FLOW structured-output error]", {
        code: e.code,
        model: flowModel,
        project_id: projectId,
        attempt,
        stop_reason: stopReason,
        stop_details: rawData?.stop_details ?? null,
        ...(contentLogsEnabled() ? { message: e.message, raw_response: rawResponse } : {}),
      });

      if (e.code === STRUCTURED_OUTPUT_REFUSAL) {
        // No retry — refusals are deterministic for the same content;
        // retrying would just spend more tokens and mask the refusal.
        return {
          ok: false,
          usage: { input_tokens: rawData?.usage?.input_tokens, output_tokens: rawData?.usage?.output_tokens },
          noRetry: true,
          failureLabel: "analysis:refusal",
          errorResponse: jsonResponse(
            {
              error:
                "The AI declined to analyze this content. Try switching to a different model in Settings, or contact the operator if this persists.",
            },
            502,
          ),
        };
      }
      if (e.code === STRUCTURED_OUTPUT_MAX_TOKENS) {
        return {
          ok: false,
          usage: { input_tokens: rawData?.usage?.input_tokens, output_tokens: rawData?.usage?.output_tokens },
          noRetry: true,
          failureLabel: "analysis:max_tokens",
          errorResponse: jsonResponse(
            { error: "Analysis output was truncated. Please try again or use a smaller project." },
            502,
          ),
        };
      }
      // STRUCTURED_OUTPUT_PARSE_FAIL → fall through to existing retry path.
    } else {
      throw e;
    }
    return {
      ok: false,
      usage: { input_tokens: rawData?.usage?.input_tokens, output_tokens: rawData?.usage?.output_tokens },
      errorResponse: jsonResponse(
        { error: "AI analysis returned unexpected format. Please try again." },
        502,
      ),
    };
  }

  const toolCall = normalised.toolCalls.find((tc) => tc.name === SUBMIT_FLOW_TOOL.name);
  const usage = {
    input_tokens: normalised.usage?.input_tokens,
    output_tokens: normalised.usage?.output_tokens,
  };

  if (!toolCall?.arguments) {
    console.error("No tool_use block found in response", {
      model: flowModel,
      attempt,
      stop_reason: stopReason,
      response_chars: rawResponse.length,
      ...(contentLogsEnabled() ? { raw_response: rawResponse } : {}),
    });
    if (isTruncatedStop(stopReason)) return truncatedFailure(usage);
    return {
      ok: false,
      usage,
      errorResponse: jsonResponse(
        { error: "AI analysis returned unexpected format. Please try again." },
        502,
      ),
    };
  }

  // Normalize stringified-JSON pillars BEFORE validation; keep the list
  // of repaired keys so the winning attempt can disclose them.
  const { output: flowResult, repairedPillars } = repairToolOutput(toolCall.arguments);

  const pillarValidity = [
    isValidPillar(flowResult.find),
    isValidPillar(flowResult.lead),
    isValidPillar(flowResult.organize),
    isValidPillar(flowResult.write),
  ];
  const validPillarCount = pillarValidity.filter(Boolean).length;
  const hasSummary = !!flowResult.summary && typeof flowResult.summary === "string";

  if (validPillarCount < 3 || !hasSummary) {
    const pillarShape: Record<string, string> = {};
    for (const k of ["summary", "find", "lead", "organize", "write"] as const) {
      const v = (flowResult as Record<string, unknown>)[k];
      pillarShape[k] = v === undefined ? "undefined" : v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
    }
    console.error("FLOW schema validation failed", {
      model: flowModel,
      attempt,
      validPillarCount,
      hasSummary,
      stop_reason: stopReason,
      input_tokens: usage.input_tokens ?? null,
      output_tokens: usage.output_tokens ?? null,
      tool_call_present: !!toolCall,
      tool_argument_keys: Object.keys(flowResult ?? {}),
      pillar_shape: pillarShape,
      summary_len: typeof flowResult?.summary === "string" ? (flowResult.summary as string).length : 0,
    });
    if (contentLogsEnabled()) {
      console.error("FLOW raw tool input (full)", {
        model: flowModel,
        attempt,
        raw_tool_input: JSON.stringify(flowResult),
      });
    }
    // A tool call cut mid-arguments parses to a shell that fails here.
    if (isTruncatedStop(stopReason)) return truncatedFailure(usage);
    return {
      ok: false,
      usage,
      errorResponse: jsonResponse(
        { error: "Analysis could not be completed with this model — try Claude Sonnet 4.6." },
        502,
      ),
    };
  }

  return { ok: true, flowResult, repairedPillars, usage };
}

// Minimal structural views of the two clients (the concrete client's
// generic instance type does not cross module boundaries cleanly — same
// approach as context-prompt/persist.ts and _shared/_stats.ts).
type UsageInsertClient = {
  from: (table: string) => {
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
};
type BudgetRpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
};

/** Billing dependencies. The two clients are deliberately distinct
 *  (CLAUDE.md §4): the RLS-scoped user client writes the token_usage
 *  history row; the service-role client calls the increment_tokens_used
 *  RPC — the single budget write path. Do not collapse them. */
export interface BillingDeps {
  supabase: unknown;
  adminSupabase: unknown;
  userId: string;
  projectId: string;
  flowModel: string;
}

// Bill a FAILED attempt: the provider charged for it, so both the
// token_usage history and the budget counter must reflect it even though
// no report is produced. (Previously schema failures wrote the history
// row but skipped the counter, and refusal/max_tokens recorded nothing.)
// Never throws — a billing hiccup must not mask the prepared error
// response the caller is about to return.
export async function billFailedAttempt(
  label: string,
  usage: { input_tokens?: number; output_tokens?: number },
  deps: BillingDeps,
): Promise<void> {
  const supabase = deps.supabase as UsageInsertClient;
  const adminSupabase = deps.adminSupabase as BudgetRpcClient;
  const { userId, projectId, flowModel } = deps;
  try {
    const inputTokens = usage.input_tokens ?? 0;
    const outputTokens = usage.output_tokens ?? 0;
    const { error: usageErr } = await supabase.from("token_usage").insert({
      user_id: userId,
      project_id: projectId,
      function_name: label,
      model_used: flowModel,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });
    if (usageErr) console.error("[analysis] token_usage insert failed:", JSON.stringify(usageErr));
    const { error: rpcErr } = await adminSupabase.rpc("increment_tokens_used", {
      user_uuid: userId,
      amount: inputTokens + outputTokens,
    });
    if (rpcErr) console.error("[analysis] increment_tokens_used failed:", JSON.stringify(rpcErr));
  } catch (e) {
    console.error("[analysis] failed-attempt billing threw:", e);
  }
}
