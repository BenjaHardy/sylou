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

import { sliceSafe } from "./_text.ts";
import { CLAUDE_THINKING_OFF_BETWEEN_TOOLS, type ClaudeEffort, type MistralEffort } from "./_models.ts";

export type ProviderId = "mistral" | "anthropic" | "deepseek";
export type { ClaudeEffort, MistralEffort };

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
  /** Anthropic only: the assistant turn's content blocks exactly as the API
   *  returned them (thinking, redacted_thinking, text, tool_use). Set by
   *  normaliseResponse and echoed verbatim by toAnthropicBody so the thinking
   *  blocks survive a tool loop; toOpenAIBody drops the field. */
  raw_content?: unknown[];
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
  tool_choice?: "auto" | "none";
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
    // An Anthropic assistant turn goes back as received: inside a tool-use
    // turn the API requires its thinking blocks complete and unmodified, and
    // the 5.5 family binds them to this exact prefix (preserved thinking).
    if (m.role === "assistant" && Array.isArray(m.raw_content) && m.raw_content.length > 0) {
      msgs.push({ role: "assistant", content: m.raw_content });
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
  // Adaptive thinking: the model decides when and how much to think.
  // Omitted = no thinking on Sonnet 4.6 / Opus 4.8; Opus 5.5 and Fable 5.1
  // think regardless (always on). Sonnet 5.5 rejects "disabled", so its
  // "off" is between_tools. Thinking blocks come back inside content[];
  // normaliseResponse reads only the text / tool_use ones and keeps the
  // whole array as raw_content for the echo. Defaults: _thinking.ts.
  const betweenTools = !opts.thinking && CLAUDE_THINKING_OFF_BETWEEN_TOOLS.has(opts.model);
  if (opts.thinking) {
    body.thinking = { type: "adaptive" };
  } else if (betweenTools) {
    body.thinking = { type: "between_tools" };
  }
  // between_tools is accepted at effort high or below; clamp loudly, as
  // resolveEffort does for Sonnet 4.6 and xhigh.
  let effort = opts.effort;
  if (betweenTools && (effort === "xhigh" || effort === "max")) {
    console.warn(`[effort] ${opts.model}: between_tools does not accept ${effort}; clamped to high`);
    effort = "high";
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
  if (effort) {
    outputConfig.effort = effort;
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
    } else if (opts.tool_choice === "none") {
      body.tool_choice = { type: "none" };
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
// AND the desired level is not "none". This is exactly what
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
    // raw_content is the Anthropic echo; Mistral 422-rejects unknown fields.
    messages: opts.messages.map(({ raw_content: _raw, ...m }) => m),
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
  usage?: TokenUsage;
  /** Provider stop/finish reason as sent on the wire (Anthropic
   *  `stop_reason`, OpenAI-shape `finish_reason`); null when absent. Feed
   *  it to isTruncatedStop() to detect a reply cut off at max_tokens. */
  stopReason: string | null;
  /** Anthropic `stop_details` (the refusal category and explanation, only
   *  on a refusal); null otherwise. Logged as metadata, never shown. */
  stopDetails: unknown;
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
  // Anthropic
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  // Mistral
  prompt_tokens_details?: { cached_tokens?: number };
  // DeepSeek
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}
interface RawResponse {
  content?: RawContentBlock[];
  stop_reason?: string;
  stop_details?: unknown;
  choices?: Array<{ message?: RawMessage; finish_reason?: string }>;
  usage?: RawUsage;
}
interface RawStreamChunk {
  choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown }; finish_reason?: string }>;
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string; stop_details?: unknown };
  stop_details?: unknown;
  content_block?: { type?: string };
  message?: { usage?: RawUsage };
  usage?: RawUsage;
}

/** Provider-reported token usage in one shape. The cache fields are the
 *  only proof that prompt caching is working (docs/model-configuration.md). */
export interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  /** Prompt tokens served from the provider's cache. */
  cache_read_tokens?: number;
  /** Prompt tokens written to the cache by this call (Anthropic only). */
  cache_write_tokens?: number;
}

/** Anthropic, Mistral and DeepSeek field names folded into TokenUsage;
 *  only the fields the provider reported are present. */
export function normaliseUsage(raw: RawUsage | undefined): TokenUsage | undefined {
  if (!raw) return undefined;
  const usage: TokenUsage = {};
  const input = raw.input_tokens ?? raw.prompt_tokens;
  const output = raw.output_tokens ?? raw.completion_tokens;
  const read = raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? raw.prompt_cache_hit_tokens;
  if (input !== undefined) usage.input_tokens = input;
  if (output !== undefined) usage.output_tokens = output;
  if (read !== undefined) usage.cache_read_tokens = read;
  if (raw.cache_creation_input_tokens !== undefined) usage.cache_write_tokens = raw.cache_creation_input_tokens;
  return usage;
}

/** Usage carried by a streaming chunk: Anthropic's message_start (the
 *  prompt side, cache fields included) and message_delta (the output), the
 *  OpenAI shape's final chunk. */
export function extractStreamUsage(parsed: unknown): TokenUsage | undefined {
  if (!parsed || typeof parsed !== "object") return undefined;
  const p = parsed as RawStreamChunk;
  return normaliseUsage(p.message?.usage ?? p.usage);
}

/** One line per completed call with the provider's token split. */
export function logUsage(provider: ProviderId, usage: TokenUsage | undefined, stream = false): void {
  if (usage) console.log("[usage]", JSON.stringify({ provider, ...(stream ? { stream } : {}), ...usage }));
}

export function normaliseResponse(
  provider: ProviderId,
  raw: unknown,
  opts?: { structuredOutputName?: string },
): NormalisedResponse {
  const r = raw as RawResponse;
  const usage = normaliseUsage(r.usage);
  logUsage(provider, usage);
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
      if (isRefusalStop(stopReason)) {
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
        ...(blocks.length ? { raw_content: blocks } : {}),
      },
      usage,
      stopReason: r.stop_reason ?? null,
      stopDetails: r.stop_details ?? null,
    };
  }
  // OpenAI-shape (Mistral/DeepSeek)
  const msg: RawMessage = r.choices?.[0]?.message ?? {};
  // Mistral reasoning models (reasoning_effort ≠ "none") return content as
  // an ARRAY of chunks (ThinkChunk + TextChunk) instead of a string. A
  // string-only read here silently dropped the whole answer whenever the
  // model replied in text on a non-streaming path (chat two-pass Call #1,
  // context-prompt) — the user saw "No response generated."
  const text = textFromContent(msg.content);
  const toolCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc) => ({
        id: tc.id ?? "",
        name: tc.function?.name ?? "",
        arguments: safeJSON(tc.function?.arguments ?? "{}"),
      }))
    : [];
  // Echo back ONLY the contract fields — never the provider's raw message.
  // Response messages arrive decorated with extra fields (GLM 5.2 via the
  // Mistral API adds `index`), and Mistral's third-party serving stack
  // 422-rejects them (`extra_forbidden`) when the assistant turn is echoed
  // into the follow-up request of a tool loop; native Mistral models merely
  // tolerated their own decorations, which is why the raw pass-through
  // survived until GLM landed. `content` is passed through UNCHANGED apart
  // from an undefined/null -> "" normalization (Medium 3.5 reasoning
  // replies are chunk ARRAYS and must round-trip as such); tool_calls
  // entries are rebuilt with their raw STRING `arguments` preserved (the
  // parsed variants in `toolCalls` above are for OUR consumption only).
  const echoToolCalls = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((tc) => ({
        id: tc.id ?? "",
        type: "function" as const,
        function: {
          name: tc.function?.name ?? "",
          arguments: tc.function?.arguments ?? "{}",
        },
      }))
    : [];
  return {
    text,
    toolCalls,
    assistantMessage: {
      role: "assistant",
      content: msg.content ?? "",
      ...(echoToolCalls.length ? { tool_calls: echoToolCalls } : {}),
    },
    usage,
    stopReason: r.choices?.[0]?.finish_reason ?? null,
    stopDetails: null,
  };
}

// Extract user-visible text from an OpenAI-shape `content` value. Plain
// completions use a string; Mistral reasoning models return an ARRAY of
// chunks ({type:"thinking"|"text", …}) — only the text chunks are the
// answer. Shared by normaliseResponse (non-streaming) and extractDeltaText
// (streaming) so the two parsers handle the same wire shapes identically
// and cannot drift apart again.
function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return (content as RawContentBlock[])
      .filter((b) => b?.type === "text")
      .map((b) => b.text ?? "")
      .join("");
  }
  return "";
}

// Extract a single text delta from a streaming SSE chunk JSON, model-agnostic.
export function extractDeltaText(parsed: unknown, _provider: ProviderId): string | null {
  const p = parsed as RawStreamChunk;
  // OpenAI-shape
  const choices = p.choices;
  const content = choices?.[0]?.delta?.content;
  if (content && (typeof content === "string" || Array.isArray(content))) {
    return textFromContent(content);
  }
  // Anthropic-shape
  if (p.type === "content_block_delta") {
    const t = p.delta?.text;
    if (typeof t === "string") return t;
  }
  return null;
}

/**
 * Provider stop/finish reason carried by a streaming chunk, model-agnostic:
 * OpenAI-shape `choices[0].finish_reason` (on the last content chunk) or
 * Anthropic's `message_delta` → `delta.stop_reason`. null when the chunk
 * carries none. A reply cut off at max_tokens is reported this way by the
 * provider — it is not an error; see isTruncatedStop().
 */
export function extractStopReason(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as RawStreamChunk;
  const finish = p.choices?.[0]?.finish_reason;
  if (typeof finish === "string" && finish) return finish;
  if (p.type === "message_delta") {
    const stop = p.delta?.stop_reason;
    if (typeof stop === "string" && stop) return stop;
  }
  return null;
}

/**
 * True when a streaming chunk carries the model's reasoning rather than
 * answer text: an OpenAI-shape delta whose content array holds a "thinking"
 * block (Mistral reasoning models, GLM via the Mistral API) or a non-empty
 * `reasoning_content` (DeepSeek-style), or Anthropic's thinking block start
 * / thinking_delta. Only ever used as a signal (the "thinking" phase): the
 * reasoning text itself is neither forwarded nor stored.
 */
export function isThinkingDelta(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as RawStreamChunk;
  const delta = p.choices?.[0]?.delta;
  if (delta) {
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) return true;
    if (Array.isArray(delta.content) && (delta.content as RawContentBlock[]).some((b) => b?.type === "thinking")) {
      return true;
    }
  }
  if (p.type === "content_block_delta" && p.delta?.type === "thinking_delta") return true;
  if (p.type === "content_block_start" && p.content_block?.type === "thinking") return true;
  return false;
}

/** Anthropic's `stop_details` from a streaming `message_delta` chunk (the
 *  refusal category and explanation); null when the chunk carries none. */
export function extractStopDetails(parsed: unknown): unknown {
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as RawStreamChunk;
  if (p.type !== "message_delta") return null;
  return p.delta?.stop_details ?? p.stop_details ?? null;
}

/** True when a stop reason means the output hit max_tokens: Anthropic
 *  "max_tokens", OpenAI-shape (Mistral/DeepSeek/GLM) "length". */
export function isTruncatedStop(reason: string | null | undefined): boolean {
  return reason === "max_tokens" || reason === "length";
}

/** True when the provider's safety classifier declined the request
 *  (Anthropic `stop_reason: "refusal"`: an HTTP 200 with no answer). */
export function isRefusalStop(reason: string | null | undefined): boolean {
  return reason === "refusal";
}

/** The reply text when the model returned none: an explicit message for a
 *  refusal or a ceiling spent on thinking, the historical placeholder
 *  otherwise. No fallback model is ever tried, so the disclosed model is
 *  always the one that answered. Persisted as the reply, so the model reads
 *  it on the next turn too. */
export function fallbackReplyText(stopReason: string | null | undefined): string {
  if (isRefusalStop(stopReason)) {
    return "The AI declined this request (its provider's safety classifier flagged the content). Try rephrasing it, or switch to a different model in Settings.";
  }
  if (isTruncatedStop(stopReason)) {
    return "The model used its whole output limit on thinking and returned no answer. Try a lower reasoning level in Settings, or a more focused question.";
  }
  return "No response generated.";
}

/** The error shown when a non-streamed provider call hit callLLM's timeout
 *  (a long think inside a tool round or the writing summary). */
export const PROVIDER_TIMEOUT_MESSAGE =
  "The model did not answer within the time limit. Try a lower reasoning level in Settings, or a more focused question.";

/** fetchWithTimeout's abort: the provider's response had not started within the limit. */
export class ProviderTimeoutError extends Error {
  constructor(timeoutMs: number, cause: unknown) {
    super(`Provider request timed out after ${Math.round(timeoutMs / 1000)}s`, { cause });
    this.name = "ProviderTimeoutError";
  }
}

export function isProviderTimeout(err: unknown): boolean {
  return err instanceof ProviderTimeoutError;
}

/**
 * Clean LLM content that may be wrapped in Mistral's structured JSON format.
 * (P4-1 seam #2 — moved verbatim from byte-identical copies in chat/ and
 * context-prompt/; lives here beside its content-parsing siblings.)
 */
export function cleanLLMContent(content: unknown): string {
  if (!content) return "";
  // Already an array (Mistral structured format passed as object, not string)
  if (Array.isArray(content)) {
    return content
      .filter(b => b?.type === "text")
      .map(b => b.text ?? b.content ?? "")
      .join("");
  }
  if (typeof content !== "string") return String(content);
  const trimmed = content.trim();
  if (!trimmed.startsWith("[")) return content;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every(b => b?.type === "text")) {
      return parsed.map(b => b.text ?? b.content ?? "").join("");
    }
  } catch { /* not JSON */ }
  return content;
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
  /** Plain mode when tools are present and forceTool is not set: "auto" is
   *  the default on both paths; "none" keeps the tool list on the wire while
   *  forbidding calls (OpenAI path verbatim, Anthropic as {type: "none"}). */
  tool_choice?: "auto" | "none";
  temperature?: number;
  json_schema?: { name: string; schema: Record<string, unknown> };
  thinking?: boolean;
  effort?: ClaudeEffort;
  /** Mistral-only; ignored for non-Mistral providers. Pass the result
   *  of resolveMistralEffort() — it already encodes the allowlist and
   *  "none" → undefined collapsing, so we just forward it. */
  mistral_effort?: MistralEffort;
  /** Abort if the provider's response hasn't STARTED after this many ms
   *  (default 120s). The timer clears once headers arrive, so streaming
   *  bodies are never cut mid-stream; non-streaming provider APIs send
   *  headers with the finished body, so there it bounds the whole
   *  generation. analysis passes 145s: the hosted request-idle limit is
   *  150s, and an in-contract timeout (billing + honest error) must beat
   *  the platform's opaque 504. */
  timeoutMs?: number;
}): Promise<Response> {
  const provider = providerFor(opts.model);
  const key = Deno.env.get(envKeyFor(provider));
  if (!key) throw new Error(`Missing API key for ${provider}`);
  // Both translators consume tools/tool_choice/forceTool from the spread and
  // ignore the other path's knobs; only per-provider quirks are gated here.
  const body =
    provider === "anthropic"
      ? toAnthropicBody({ ...opts })
      : toOpenAIBody({
          ...opts,
          // DeepSeek quirk: deepseek-v4-flash runs in thinking mode, which
          // rejects a NAMED tool_choice with HTTP 400 "Thinking mode does not
          // support this tool_choice". Fall back to the plain default ("auto"
          // when tools are present) — prompt-level compliance, the pre-forcing
          // behavior. Mistral keeps real named forcing.
          forceTool: provider === "deepseek" ? undefined : opts.forceTool,
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
  // outgoing body, once per request (streaming ones included — the line is
  // written before the fetch, never per delta). Excludes `messages` /
  // `system` / `tools` so the line stays well under the log truncation
  // limit. `reasoning_effort` is only included when actually present in the
  // body — no `null` noise for Anthropic calls.
  {
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
    // Echoed Anthropic assistant turns (a tool loop in progress), counts only.
    const echoed = opts.messages.filter((m) => Array.isArray(m.raw_content) && m.raw_content.length > 0);
    if (echoed.length > 0) {
      logLine.echoed_turns = echoed.length;
      logLine.echoed_thinking_blocks = echoed.reduce(
        (n, m) => n + (m.raw_content as RawContentBlock[]).filter((blk) => blk?.type === "thinking" || blk?.type === "redacted_thinking").length,
        0,
      );
    }
    console.log("[callLLM] outbound", JSON.stringify(logLine));
  }
  return await fetchWithTimeout(endpointFor(provider), {
    method: "POST",
    headers: authHeadersFor(provider, key),
    body: JSON.stringify(body),
  }, opts.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS);
}

/** Default outbound-request timeout for provider calls (see callLLM.timeoutMs). */
const DEFAULT_LLM_TIMEOUT_MS = 120_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * fetch() that aborts if the response hasn't STARTED after `timeoutMs`.
 *
 * The timer is cleared as soon as the response promise settles (headers
 * arrived), so a streaming body is never cut mid-stream — the timeout only
 * bounds the wait for the stream to begin. Non-streaming provider APIs send
 * headers together with the finished body, so there it bounds the whole
 * generation. Abort surfaces as a ProviderTimeoutError (isProviderTimeout),
 * never as the raw DOMException.
 * `fetchImpl` is injectable for tests; production always uses global fetch.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: FetchLike = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) throw new ProviderTimeoutError(timeoutMs, err);
    throw err;
  } finally {
    clearTimeout(timer);
  }
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
  if (msg.length > 200) msg = sliceSafe(msg, 197) + "...";
  return `${providerName}: ${msg}`;
}
