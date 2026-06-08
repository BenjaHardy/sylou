// ============================================================
// Canonical shared LLM helper.
//
// Single source of truth, imported via `../_shared/_llm.ts` by:
//   supabase/functions/analysis/index.ts
//   supabase/functions/chat/index.ts
//   supabase/functions/editor-action/index.ts
//   supabase/functions/context-prompt/index.ts
//
// Provider-agnostic LLM call helper: translates OpenAI-style messages
// + tools into the right shape per provider (Anthropic / Mistral /
// DeepSeek), issues the fetch, and normalises non-streaming responses
// back to OpenAI shape so callers don't branch. Also exposes a
// streaming-delta extractor and a safe upstream-error formatter.
// ============================================================

export type ProviderId = "mistral" | "anthropic" | "deepseek";

export interface LLMTool {
  // OpenAI-style tool definition
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | unknown;
  tool_call_id?: string;
  // For assistant messages that issued tool calls (OpenAI-shape)
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export function providerFor(modelId: string): ProviderId {
  if (modelId.startsWith("claude-")) return "anthropic";
  if (modelId.startsWith("deepseek-")) return "deepseek";
  return "mistral";
}

export function endpointFor(provider: ProviderId): string {
  if (provider === "anthropic") return "https://api.anthropic.com/v1/messages";
  if (provider === "deepseek") return "https://api.deepseek.com/v1/chat/completions";
  return "https://api.mistral.ai/v1/chat/completions";
}

export function envKeyFor(provider: ProviderId): string {
  if (provider === "anthropic") return "ANTHROPIC_API_KEY";
  if (provider === "deepseek") return "DEEPSEEK_API_KEY";
  return "MISTRAL_API_KEY";
}

export function authHeadersFor(provider: ProviderId, key: string): Record<string, string> {
  if (provider === "anthropic") {
    return {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

// Translate OpenAI-style messages + tools into Anthropic Messages format.
export function toAnthropicBody(opts: {
  model: string;
  messages: LLMMessage[];
  max_tokens: number;
  tools?: LLMTool[];
  stream?: boolean;
  forceTool?: string;
  temperature?: number;
  json_schema?: { name: string; schema: Record<string, unknown> };
}): Record<string, unknown> {
  let system = "";
  const msgs: Array<Record<string, unknown>> = [];
  for (const m of opts.messages) {
    if (m.role === "system") {
      system += (system ? "\n\n" : "") + (typeof m.content === "string" ? m.content : JSON.stringify(m.content));
      continue;
    }
    if (m.role === "tool") {
      msgs.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: m.tool_call_id,
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          },
        ],
      });
      continue;
    }
    if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
      const blocks: unknown[] = [];
      if (m.content && typeof m.content === "string" && m.content.trim()) {
        blocks.push({ type: "text", text: m.content });
      }
      for (const tc of m.tool_calls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: safeJSON(tc.function.arguments),
        });
      }
      msgs.push({ role: "assistant", content: blocks });
      continue;
    }
    msgs.push({
      role: m.role,
      content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    });
  }

  const body: Record<string, unknown> = {
    model: opts.model,
    max_tokens: opts.max_tokens,
    system: system || undefined,
    messages: msgs,
  };
  if (opts.stream) body.stream = true;
  if (opts.temperature !== undefined) {
    // Anthropic API caps temperature at 1.0; clamp defensively.
    body.temperature = Math.min(1.0, Math.max(0.0, opts.temperature));
  }
  // Structured Outputs (JSON outputs) — GA on Sonnet 4.6 / Opus 4.7+ on the
  // Claude API; no beta header required. When set, we do NOT also send
  // tools/tool_choice. The JSON is returned as a text block in
  // response.content[0].text and is schema-validated server-side.
  if (opts.json_schema) {
    body.output_config = {
      format: {
        type: "json_schema",
        name: opts.json_schema.name,
        schema: opts.json_schema.schema,
      },
    };
  } else if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (opts.forceTool) {
      body.tool_choice = { type: "tool", name: opts.forceTool };
    }
  }
  return body;
}

function safeJSON(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

// Build OpenAI-shape body (used by Mistral & DeepSeek).
export function toOpenAIBody(opts: {
  model: string;
  messages: LLMMessage[];
  max_tokens: number;
  tools?: LLMTool[];
  stream?: boolean;
  tool_choice?: "auto" | "none";
  temperature?: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.max_tokens,
  };
  if (opts.stream) body.stream = true;
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.tool_choice ?? "auto";
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  return body;
}

// Extract assistant text + tool calls from a non-streaming response,
// normalised to OpenAI-shape so callers don't branch.
export interface NormalisedResponse {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  // Raw assistant message in OpenAI-shape (for appending to history).
  assistantMessage: LLMMessage;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Tagged error codes the Anthropic Structured-Outputs path can throw via
 * normaliseResponse, so callers can route them through their existing
 * error/retry pipelines without string-matching.
 */
export const STRUCTURED_OUTPUT_REFUSAL = "STRUCTURED_OUTPUT_REFUSAL";
export const STRUCTURED_OUTPUT_PARSE_FAIL = "STRUCTURED_OUTPUT_PARSE_FAIL";
export const STRUCTURED_OUTPUT_MAX_TOKENS = "STRUCTURED_OUTPUT_MAX_TOKENS";

export class StructuredOutputError extends Error {
  code: string;
  raw?: unknown;
  constructor(code: string, message: string, raw?: unknown) {
    super(message);
    this.code = code;
    this.raw = raw;
  }
}

export function normaliseResponse(
  provider: ProviderId,
  raw: any,
  opts?: { structuredOutputName?: string },
): NormalisedResponse {
  if (provider === "anthropic") {
    const blocks: any[] = raw?.content ?? [];
    let text = "";
    const toolCalls: NormalisedResponse["toolCalls"] = [];
    const oaToolCalls: NonNullable<LLMMessage["tool_calls"]> = [];
    for (const b of blocks) {
      if (b.type === "text") text += b.text ?? "";
      if (b.type === "tool_use") {
        toolCalls.push({ id: b.id, name: b.name, arguments: b.input ?? {} });
        oaToolCalls.push({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        });
      }
    }
    // Structured Outputs path: caller asked for JSON conforming to a schema.
    // Synthesize a tool-call shape so downstream code reads `toolCalls[0].arguments`
    // exactly as it did for tool_use. Refusals / max_tokens / parse failures
    // throw a tagged StructuredOutputError so callers can branch deterministically.
    if (opts?.structuredOutputName) {
      const stopReason = raw?.stop_reason ?? null;
      if (stopReason === "refusal") {
        throw new StructuredOutputError(
          STRUCTURED_OUTPUT_REFUSAL,
          "Claude declined to produce a structured output for this request.",
          raw,
        );
      }
      if (stopReason === "max_tokens") {
        throw new StructuredOutputError(
          STRUCTURED_OUTPUT_MAX_TOKENS,
          "Structured output was truncated by max_tokens.",
          raw,
        );
      }
      const trimmed = text.trim();
      if (!trimmed) {
        throw new StructuredOutputError(
          STRUCTURED_OUTPUT_PARSE_FAIL,
          "Structured Outputs returned no text block.",
          raw,
        );
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(trimmed);
      } catch (e) {
        throw new StructuredOutputError(
          STRUCTURED_OUTPUT_PARSE_FAIL,
          `Structured Outputs text was not valid JSON: ${(e as Error).message}`,
          raw,
        );
      }
      toolCalls.push({
        id: "structured-output",
        name: opts.structuredOutputName,
        arguments: parsed,
      });
    }
    return {
      text,
      toolCalls,
      assistantMessage: {
        role: "assistant",
        content: text,
        ...(oaToolCalls.length ? { tool_calls: oaToolCalls } : {}),
      },
      usage: raw?.usage
        ? { input_tokens: raw.usage.input_tokens, output_tokens: raw.usage.output_tokens }
        : undefined,
    };
  }
  // OpenAI-shape (Mistral/DeepSeek)
  const msg = raw?.choices?.[0]?.message ?? {};
  const text = typeof msg.content === "string" ? msg.content : "";
  const toolCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name,
        arguments: safeJSON(tc.function?.arguments ?? "{}"),
      }))
    : [];
  return {
    text,
    toolCalls,
    assistantMessage: msg as LLMMessage,
    usage: raw?.usage
      ? {
          input_tokens: raw.usage.prompt_tokens ?? raw.usage.input_tokens,
          output_tokens: raw.usage.completion_tokens ?? raw.usage.output_tokens,
        }
      : undefined,
  };
}

// Extract a single text delta from a streaming SSE chunk JSON, model-agnostic.
export function extractDeltaText(parsed: any, _provider: ProviderId): string | null {
  // OpenAI-shape
  const choices = parsed?.choices;
  const content = choices?.[0]?.delta?.content;
  if (content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .filter((b: any) => b?.type === "text")
        .map((b: any) => b.text ?? "")
        .join("");
    }
  }
  // Anthropic-shape
  if (parsed?.type === "content_block_delta") {
    const t = parsed?.delta?.text;
    if (typeof t === "string") return t;
  }
  return null;
}

// Unified call: returns raw fetch Response so callers handle stream vs non-stream uniformly.
export async function callLLM(opts: {
  model: string;
  messages: LLMMessage[];
  max_tokens: number;
  tools?: LLMTool[];
  stream?: boolean;
  forceTool?: string;
  temperature?: number;
  json_schema?: { name: string; schema: Record<string, unknown> };
}): Promise<Response> {
  const provider = providerFor(opts.model);
  const key = Deno.env.get(envKeyFor(provider));
  if (!key) throw new Error(`Missing API key for ${provider}`);
  const body =
    provider === "anthropic"
      ? toAnthropicBody({ ...opts })
      : toOpenAIBody({ ...opts, tool_choice: opts.tools ? "auto" : undefined });
  return await fetch(endpointFor(provider), {
    method: "POST",
    headers: authHeadersFor(provider, key),
    body: JSON.stringify(body),
  });
}

// Extract a safe, user-friendly error message from an upstream provider error
// body. Only surfaces `error.message` (string), truncated, to avoid leaking
// keys, account IDs, request IDs, headers, or stack traces.
export function extractProviderError(provider: ProviderId, status: number, rawBody: string): string {
  const providerName = provider === "anthropic" ? "Claude" : provider === "deepseek" ? "DeepSeek" : "Mistral";
  let msg = "";
  try {
    const j = JSON.parse(rawBody);
    const candidate = j?.error?.message ?? j?.error ?? j?.message;
    if (typeof candidate === "string") msg = candidate;
  } catch { /* not JSON */ }
  if (!msg) msg = `HTTP ${status}`;
  if (msg.length > 200) msg = msg.slice(0, 197) + "...";
  return `${providerName}: ${msg}`;
}
