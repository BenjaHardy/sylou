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

// Effort taxonomy is provider-specific:
//   - Anthropic (Claude): "low" | "medium" | "high" | "xhigh"
//   - Mistral reasoning models (Medium 3.5, Small): "high" | "none"
// See _shared/_thinking.ts for the canonical types and the per-function
// tables. We re-declare the literal unions here only to keep _llm.ts
// free of cross-imports from _thinking.ts (avoids a circular dep risk
// as both files grow).
export type ClaudeEffort  = "low" | "medium" | "high" | "xhigh";
export type MistralEffort = "high" | "none";

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
  disableParallelToolUse?: boolean;
  temperature?: number;
  json_schema?: { name: string; schema: Record<string, unknown> };
  thinking?: boolean;
  effort?: ClaudeEffort;
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
  // Adaptive thinking — opt-in on Sonnet 4.6 / Opus 4.7+. The model
  // decides when and how much to think on each request. Thinking
  // blocks come back inside content[] alongside text/tool_use and
  // are silently dropped by normaliseResponse (which filters by
  // block.type). See _thinking.ts for per-function defaults.
  if (opts.thinking) {
    body.thinking = { type: "adaptive" };
  }
  // Structured Outputs (JSON outputs) — GA on Sonnet 4.6 / Opus 4.7+ on the
  // Claude API; no beta header required. When set, we do NOT also send
  // tools/tool_choice. The JSON is returned as a text block in
  // response.content[0].text and is schema-validated server-side.
  // `output_config` carries both `format` (structured outputs) and
  // `effort` (reasoning depth), so we assemble it once.
  const outputConfig: Record<string, unknown> = {};
  if (opts.json_schema) {
    outputConfig.format = {
      type: "json_schema",
      schema: sanitizeAnthropicSchema(opts.json_schema.schema),
    };
  }
  if (opts.effort) {
    outputConfig.effort = opts.effort;
  }
  if (Object.keys(outputConfig).length > 0) {
    body.output_config = outputConfig;
  }
  if (!opts.json_schema && opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (opts.forceTool) {
      body.tool_choice = {
        type: "tool",
        name: opts.forceTool,
        ...(opts.disableParallelToolUse ? { disable_parallel_tool_use: true } : {}),
      };
    }
  }
  return body;
}

function safeJSON(s: string): Record<string, unknown> {
  try { return JSON.parse(s); } catch { return {}; }
}

/**
 * Sanitize a JSON Schema for use with Anthropic's Structured Outputs.
 *
 * Structured Outputs rejects many standard JSON Schema constraints
 * (maxItems, minLength, minimum, etc.). Anthropic's official SDKs
 * strip these client-side; since we build the request body manually,
 * we replicate that behavior here.
 *
 * Stripped constraints are migrated to description text so the model
 * still receives the information, just without server-side enforcement.
 *
 * Uses an allowlist of supported keys: anything not on the list is
 * stripped preemptively, so future Anthropic schema additions don't
 * break us. The exception is `minItems`, which is kept iff the value
 * is 0 or 1 (the only values Anthropic accepts).
 *
 * See: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
 */
const ANTHROPIC_SCHEMA_ALLOWLIST = new Set([
  "type", "required", "properties", "items", "additionalProperties",
  "enum", "const", "description", "anyOf", "oneOf", "allOf", "not",
  "$ref", "title",
]);

function formatStrippedHint(key: string, value: unknown): string {
  switch (key) {
    case "minItems": return `min ${value} items`;
    case "maxItems": return `max ${value} items`;
    case "minLength": return `min ${value} chars`;
    case "maxLength": return `max ${value} chars`;
    case "minimum": return `≥ ${value}`;
    case "maximum": return `≤ ${value}`;
    case "exclusiveMinimum": return `> ${value}`;
    case "exclusiveMaximum": return `< ${value}`;
    case "multipleOf": return `multiple of ${value}`;
    case "pattern": return `pattern: ${value}`;
    case "format": return `format: ${value}`;
    case "uniqueItems": return value ? "unique items" : "";
    case "default": case "examples": return "";
    default:
      try { return `${key}: ${JSON.stringify(value)}`; } catch { return ""; }
  }
}

function sanitizeNode(node: unknown): unknown {
  // Boolean schemas (`true` / `false`) and primitives pass through.
  if (typeof node !== "object" || node === null) return node;
  if (Array.isArray(node)) return node.map(sanitizeNode);

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const stripped: Array<[string, unknown]> = [];

  for (const [k, v] of Object.entries(src)) {
    if (k === "minItems") {
      if (v === 0 || v === 1) {
        out[k] = v;
      } else {
        stripped.push([k, v]);
      }
      continue;
    }
    if (ANTHROPIC_SCHEMA_ALLOWLIST.has(k)) {
      out[k] = v;
    } else {
      stripped.push([k, v]);
    }
  }

  // Recurse into structural children.
  if (out.properties && typeof out.properties === "object" && !Array.isArray(out.properties)) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties as Record<string, unknown>)
        .map(([pk, pv]) => [pk, sanitizeNode(pv)]),
    );
  }
  if ("items" in out) out.items = sanitizeNode(out.items);
  if ("additionalProperties" in out && typeof out.additionalProperties === "object" && out.additionalProperties !== null) {
    out.additionalProperties = sanitizeNode(out.additionalProperties);
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(out[key])) {
      out[key] = (out[key] as unknown[]).map(sanitizeNode);
    }
  }
  if ("not" in out) out.not = sanitizeNode(out.not);

  // Collect all stripped constraints, then merge once into description.
  if (stripped.length > 0) {
    const hints = stripped
      .map(([k, v]) => formatStrippedHint(k, v))
      .filter((s) => s.length > 0)
      .join(", ");
    if (hints) {
      const base = typeof out.description === "string" ? out.description.trim() : "";
      out.description = base ? `${base} (${hints})` : `(${hints})`;
    }
  }

  return out;
}

export function sanitizeAnthropicSchema<T>(schema: T): T {
  return sanitizeNode(schema) as T;
}


// Build OpenAI-shape body (used by Mistral & DeepSeek).
//
// `reasoning_effort` is Mistral-only and is rejected with HTTP 422 by
// non-reasoning Mistral models (e.g. mistral-large-2512) and by every
// DeepSeek chat model. The caller is responsible for gating: pass
// `reasoning_effort` ONLY when the model is a Mistral reasoning model
// AND the desired effort is "high". This is exactly what
// resolveMistralEffort() in _thinking.ts already guarantees — it
// returns undefined whenever the field must be omitted.
export function toOpenAIBody(opts: {
  model: string;
  messages: LLMMessage[];
  max_tokens: number;
  tools?: LLMTool[];
  stream?: boolean;
  tool_choice?: "auto" | "none";
  forceTool?: string;
  temperature?: number;
  reasoning_effort?: MistralEffort;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    max_tokens: opts.max_tokens,
  };
  if (opts.stream) body.stream = true;
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    // Named forcing (OpenAI form, supported by both Mistral and DeepSeek)
    // wins over the plain mode; "auto" stays the default with tools present.
    body.tool_choice = opts.forceTool
      ? { type: "function", function: { name: opts.forceTool } }
      : opts.tool_choice ?? "auto";
  }
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  // Only emit when truthy — never send `reasoning_effort: null` or
  // `reasoning_effort: "none"` (Mistral treats omission as "no
  // reasoning" already, and "none" round-trips into our diagnostic
  // log as noise).
  if (opts.reasoning_effort && opts.reasoning_effort !== "none") {
    body.reasoning_effort = opts.reasoning_effort;
  }
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

// ── Raw provider-response shapes ──────────────────────────────────────────
// Minimal, internal (not exported) types that the two normalisers narrow the
// raw provider JSON to at the boundary. All fields optional — providers vary
// and the bodies defend with `?.`/defaults. Prefer an `unknown` param + one
// documented cast here over `any` bleeding through the whole function.
interface RawContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}
interface RawToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}
interface RawMessage {
  content?: unknown;
  tool_calls?: RawToolCall[];
}
interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
}
interface RawResponse {
  content?: RawContentBlock[];
  stop_reason?: string;
  choices?: Array<{ message?: RawMessage }>;
  usage?: RawUsage;
}
interface RawStreamChunk {
  choices?: Array<{ delta?: { content?: unknown } }>;
  type?: string;
  delta?: { text?: string };
}

export function normaliseResponse(
  provider: ProviderId,
  raw: unknown,
  opts?: { structuredOutputName?: string },
): NormalisedResponse {
  const r = raw as RawResponse;
  if (provider === "anthropic") {
    const blocks: RawContentBlock[] = r.content ?? [];
    let text = "";
    const toolCalls: NormalisedResponse["toolCalls"] = [];
    const oaToolCalls: NonNullable<LLMMessage["tool_calls"]> = [];
    // INVARIANT: iterate content[] and accumulate ONLY blocks where
    // type === "text" (and tool_use). Adaptive thinking can place a
    // `thinking` or `redacted_thinking` block at index 0, so we MUST
    // NOT shortcut to `content[0].text` — that would surface chain
    // of thought to users and break Structured Outputs JSON parsing.
    for (const b of blocks) {
      if (b.type === "text") text += b.text ?? "";
      if (b.type === "tool_use") {
        toolCalls.push({ id: b.id ?? "", name: b.name ?? "", arguments: b.input ?? {} });
        oaToolCalls.push({
          id: b.id ?? "",
          type: "function",
          function: { name: b.name ?? "", arguments: JSON.stringify(b.input ?? {}) },
        });
      }
    }
    // Structured Outputs path: caller asked for JSON conforming to a schema.
    // Synthesize a tool-call shape so downstream code reads `toolCalls[0].arguments`
    // exactly as it did for tool_use. Refusals / max_tokens / parse failures
    // throw a tagged StructuredOutputError so callers can branch deterministically.
    if (opts?.structuredOutputName) {
      const stopReason = r.stop_reason ?? null;
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
      usage: r.usage
        ? { input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens }
        : undefined,
    };
  }
  // OpenAI-shape (Mistral/DeepSeek)
  const msg: RawMessage = r.choices?.[0]?.message ?? {};
  const text = typeof msg.content === "string" ? msg.content : "";
  const toolCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc) => ({
        id: tc.id ?? "",
        name: tc.function?.name ?? "",
        arguments: safeJSON(tc.function?.arguments ?? "{}"),
      }))
    : [];
  return {
    text,
    toolCalls,
    assistantMessage: msg as unknown as LLMMessage,
    usage: r.usage
      ? {
          input_tokens: r.usage.prompt_tokens ?? r.usage.input_tokens,
          output_tokens: r.usage.completion_tokens ?? r.usage.output_tokens,
        }
      : undefined,
  };
}

// Extract a single text delta from a streaming SSE chunk JSON, model-agnostic.
export function extractDeltaText(parsed: unknown, _provider: ProviderId): string | null {
  const p = parsed as RawStreamChunk;
  // OpenAI-shape
  const choices = p.choices;
  const content = choices?.[0]?.delta?.content;
  if (content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return (content as RawContentBlock[])
        .filter((b) => b?.type === "text")
        .map((b) => b.text ?? "")
        .join("");
    }
  }
  // Anthropic-shape
  if (p.type === "content_block_delta") {
    const t = p.delta?.text;
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
  /** With forceTool: on Anthropic, also sends tool_choice.disable_parallel_tool_use
   *  so exactly one call to the forced tool comes back. The OpenAI path sends no
   *  equivalent — named forcing already yields a single call there. */
  disableParallelToolUse?: boolean;
  /** OpenAI-path plain mode when tools are present and forceTool is not set;
   *  ignored by the Anthropic path (its default is already auto). */
  tool_choice?: "auto" | "none";
  temperature?: number;
  json_schema?: { name: string; schema: Record<string, unknown> };
  thinking?: boolean;
  effort?: ClaudeEffort;
  /** Mistral-only; ignored for non-Mistral providers. Pass the result
   *  of resolveMistralEffort() — it already encodes the allowlist and
   *  "none" → undefined collapsing, so we just forward it. */
  mistral_effort?: MistralEffort;
}): Promise<Response> {
  const provider = providerFor(opts.model);
  const key = Deno.env.get(envKeyFor(provider));
  if (!key) throw new Error(`Missing API key for ${provider}`);
  // Both translators consume tools/tool_choice/forceTool from the spread and
  // ignore the other path's knobs, so no per-provider overrides are needed here.
  const body =
    provider === "anthropic"
      ? toAnthropicBody({ ...opts })
      : toOpenAIBody({
          ...opts,
          // Anthropic-only `effort` is intentionally NOT forwarded here.
          reasoning_effort: provider === "mistral" ? opts.mistral_effort : undefined,
        });
  // Mistral quirk: `temperature === 0` triggers greedy sampling, and the
  // API then rejects the request unless `top_p` is exactly 1.0
  // (HTTP 400, code 3054, "top_p must be 1 when using greedy sampling").
  // Inject it here so FLOW (which deliberately runs at temperature 0 for
  // determinism) works on all Mistral models including Medium 3.5.
  // Scoped to Mistral only: Anthropic uses a different body shape and
  // DeepSeek doesn't have this constraint.
  if (provider === "mistral" && (body as Record<string, unknown>).temperature === 0) {
    (body as Record<string, unknown>).top_p = 1;
  }
  // Diagnostic: log the top-level keys + reasoning-control fields of the
  // outgoing body. Skipped for streaming requests to avoid log spam on token
  // deltas. Excludes `messages` / `system` / `tools` so the line stays well
  // under the log truncation limit. `reasoning_effort` is only included
  // when actually present in the body — no more `null` noise for Anthropic
  // calls.
  if (!opts.stream) {
    const b = body as Record<string, unknown>;
    const { messages: _m, system: _s, tools: _t, ...preview } = b;
    const logLine: Record<string, unknown> = {
      provider,
      model: opts.model,
      top_level_keys: Object.keys(b),
      preview,
    };
    if (b.thinking !== undefined) logLine.thinking = b.thinking;
    if (b.output_config !== undefined) logLine.output_config = b.output_config;
    if (b.reasoning_effort !== undefined) logLine.reasoning_effort = b.reasoning_effort;
    if (b.top_p !== undefined) logLine.top_p = b.top_p;
    console.log("[callLLM] outbound", JSON.stringify(logLine));
  }
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
