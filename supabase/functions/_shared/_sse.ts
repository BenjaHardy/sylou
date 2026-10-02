// Shared SSE streaming primitives for the edge functions (P4-1, Phase B).
//
// Extracted from the streaming paths of chat/, context-prompt/ and
// editor-action/ — the CLAUDE.md §7 load-bearing lifecycle. Two distinct
// primitives live here and must stay distinct (B12 ruling — never unify):
//
//   - readProviderStream: the real provider-reader loop (5 former copies).
//   - replayTokenBurst: synthetic re-emission of already-complete text
//     (2 former copies — the "pseudo-stream" used when a non-streamed
//     call already produced the full answer).
//
// Everything path-specific deliberately stays in the callers: phase
// events, done/error payload construction, stream-first persistence
// tails, and controller.close() placement. chat and context-prompt share
// one enqueue-guard style (swallow — the client is gone), so their relay
// of a provider stream and their keep-alive live here too
// (relayProviderStream, keepAlive); editor-action keeps its
// clientDisconnected latch and calls readProviderStream itself.

import { extractDeltaText, extractStopReason, isThinkingDelta, type ProviderId } from "./_llm.ts";

/** Per-request factory for the SSE envelope helpers. corsHeaders is the
 *  only request-scoped dependency; the two helpers were byte-identical
 *  in chat/ and context-prompt/, and editor-action inlined the same
 *  wire bytes and headers. */
export function makeSSEHelpers(corsHeaders: Record<string, string>) {
  const encoder = new TextEncoder();

  function sseEvent(data: Record<string, unknown>): Uint8Array {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
  }

  function createSSEResponse(readable: ReadableStream) {
    return new Response(readable, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      },
    });
  }

  /** An SSE comment line: ignored by every SSE client (ours reads `data:`
   *  lines only) but bytes on the wire, which is what stops a proxy from
   *  closing a response that has gone quiet while the model thinks. */
  function sseKeepalive(): Uint8Array {
    return encoder.encode(": keep-alive\n\n");
  }

  /** Keep-alive comments for the life of a stream. Start it when the
   *  ReadableStream starts; call the returned stop() right before
   *  controller.close(). Enqueue errors are swallowed (client gone). */
  function keepAlive(
    controller: ReadableStreamDefaultController<Uint8Array>,
    intervalMs = KEEPALIVE_INTERVAL_MS,
  ): () => void {
    return startKeepalive(() => {
      try { controller.enqueue(sseKeepalive()); } catch { /* client gone */ }
    }, intervalMs);
  }

  return { sseEvent, createSSEResponse, sseKeepalive, keepAlive };
}

/** Keep-alive cadence. A reasoning model can think for a minute before its
 *  first answer token, and a response with no bytes for that long was
 *  observed being closed in front of the function (2026-10). */
export const KEEPALIVE_INTERVAL_MS = 15_000;

/** Call `tick` every `intervalMs` until the returned stop() runs. Callers
 *  start it when their ReadableStream starts and stop it right before
 *  controller.close(); `tick` must swallow its own enqueue errors. */
export function startKeepalive(tick: () => void, intervalMs = KEEPALIVE_INTERVAL_MS): () => void {
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}

/** What a provider stream contained — metadata only, never any text —
 *  for the empty-reply diagnostics. */
export interface StreamStats {
  /** `data:` chunks that parsed as JSON. */
  chunks: number;
  /** Chunks carrying reasoning (isThinkingDelta). */
  thinking: number;
  /** Chunks carrying a non-empty text delta. */
  text: number;
  /** Last finish / stop reason seen, null when the stream ended without one. */
  finish: string | null;
  /** Whether the `[DONE]` sentinel was seen. */
  sawDone: boolean;
  /** Top-level keys of the last parsed chunk. */
  lastKeys: string[];
  /** The `error` field of any chunk that carried one (provider wording). */
  providerError: unknown;
  /** Read duration. */
  ms: number;
}

function summariseError(err: unknown): unknown {
  if (typeof err === "string") return err.slice(0, 300);
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of ["type", "code", "message", "detail"]) {
      if (typeof e[k] === "string") out[k] = (e[k] as string).slice(0, 300);
    }
    return Object.keys(out).length ? out : Object.keys(e);
  }
  return err;
}

/**
 * Read a provider's SSE response and hand each text delta to the caller.
 * Returns the RAW accumulated text — cleaning (cleanLLMContent), trimming
 * and fallback strings are caller policy, not loop mechanics.
 *
 * Contract, pinned by _sse.test.ts (all five former copies behaved this
 * way — do not "improve" without a checkpoint):
 *   - `[DONE]` is skipped and the loop CONTINUES; it only exits when the
 *     reader reports done. Callers must NOT hang side effects off the
 *     [DONE] sentinel — only OpenAI-shape providers send it (Anthropic
 *     ends with message_stop); completion work belongs in the caller's
 *     tail, after this function resolves.
 *   - Deltas are filtered by truthiness: empty-string deltas are neither
 *     accumulated nor forwarded.
 *   - onToken owns the enqueue and its own disconnect-guard style; it is
 *     called inside the per-line try, so a throwing malformed chunk (or
 *     a caller guard that swallows) never kills the loop.
 *   - No final decoder flush: a trailing line not terminated by \n is
 *     deliberately dropped, exactly as before the extraction.
 *   - res.body!.getReader() is acquired here; callers must await inside
 *     their existing try so a null body lands in the same catch as before.
 *   - onStop (optional, additive 2026-09) receives the provider's stop /
 *     finish reason when a chunk carries one (Anthropic message_delta
 *     stop_reason, OpenAI-shape finish_reason) — the only way to learn a
 *     reply was cut off at max_tokens (isTruncatedStop in _llm.ts). It
 *     fires inside the per-line try like onToken; it never ends the loop.
 *   - onThinking (optional, additive 2026-10) fires ONCE per stream, at the
 *     first chunk that carries reasoning rather than answer text
 *     (isThinkingDelta in _llm.ts) — the signal behind the "thinking"
 *     phase. The reasoning text is never accumulated or forwarded.
 *   - onEnd (optional, additive 2026-10) receives StreamStats once the
 *     reader reports done — what arrived, by kind, and how the stream
 *     ended — so an empty reply can be logged as a diagnosis instead of a
 *     guess. Metadata only.
 */
export async function readProviderStream(
  res: Response,
  provider: ProviderId,
  handlers: {
    onToken: (delta: string) => void;
    onStop?: (reason: string) => void;
    onThinking?: () => void;
    onEnd?: (stats: StreamStats) => void;
  },
): Promise<string> {
  const { text, stats } = await readProviderStreamWithStats(res, provider, handlers);
  handlers.onEnd?.(stats);
  return text;
}

/** readProviderStream's loop, returning the stats alongside the raw text
 *  (the callback form above is kept for editor-action and the pins). */
export async function readProviderStreamWithStats(
  res: Response,
  provider: ProviderId,
  handlers: {
    onToken: (delta: string) => void;
    onStop?: (reason: string) => void;
    onThinking?: () => void;
  },
): Promise<{ text: string; stats: StreamStats }> {
  let fullResponse = "";
  let thinkingSignalled = false;
  const stats: StreamStats = {
    chunks: 0, thinking: 0, text: 0, finish: null, sawDone: false, lastKeys: [], providerError: null, ms: 0,
  };
  const startedAt = Date.now();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  const reader = res.body!.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split("\n");
    sseBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") {
        stats.sawDone = true;
        continue;
      }

      try {
        const parsed = JSON.parse(payload);
        stats.chunks++;
        if (parsed && typeof parsed === "object") {
          stats.lastKeys = Object.keys(parsed);
          if ((parsed as { error?: unknown }).error !== undefined) {
            stats.providerError = summariseError((parsed as { error?: unknown }).error);
          }
        }
        if (isThinkingDelta(parsed)) {
          stats.thinking++;
          if (!thinkingSignalled && handlers.onThinking) {
            thinkingSignalled = true;
            handlers.onThinking();
          }
        }
        const delta = extractDeltaText(parsed, provider);
        if (delta) {
          stats.text++;
          fullResponse += delta;
          handlers.onToken(delta);
        }
        const stop = extractStopReason(parsed);
        if (stop) {
          stats.finish = stop;
          handlers.onStop?.(stop);
        }
      } catch { /* skip malformed chunk */ }
    }
  }

  stats.ms = Date.now() - startedAt;
  return { text: fullResponse, stats };
}

/**
 * Relay a provider stream to the client the way chat and context-prompt
 * do: every text delta as a `{token}` event, one `{phase:"thinking"}` at
 * the first reasoning chunk, nothing else forwarded. Enqueue errors are
 * swallowed (the client is gone) — the guard style both functions used
 * inline. Returns the RAW text (cleaning stays caller policy), the
 * provider's stop reason and the StreamStats for the empty-reply warning.
 */
export async function relayProviderStream(
  res: Response,
  provider: ProviderId,
  controller: ReadableStreamDefaultController<Uint8Array>,
  sseEvent: (data: Record<string, unknown>) => Uint8Array,
): Promise<{ text: string; stopReason: string | null; stats: StreamStats }> {
  let stopReason: string | null = null;
  const enqueue = (bytes: Uint8Array) => {
    try { controller.enqueue(bytes); } catch { /* client gone */ }
  };
  const { text, stats } = await readProviderStreamWithStats(res, provider, {
    onToken: (delta) => enqueue(sseEvent({ token: delta })),
    onStop: (reason) => { stopReason = reason; },
    onThinking: () => enqueue(sseEvent({ phase: "thinking" })),
  });
  return { text, stopReason, stats };
}

/** Re-emit already-complete text as a PACED burst of 20-char chunks so
 *  the client renders it progressively (deliberate UX change, 2026-07-27;
 *  from its 2026-04 birth until then the burst was fully synchronous and
 *  painted the whole answer in a single frame). Yields for PACE_DELAY_MS
 *  every PACE_EVERY chunks (~100 chars per paint), with a hard cap on the
 *  total added delay so a pathologically long answer can never stall the
 *  stream-first persistence tail behind it — past the cap, the remainder
 *  flushes at once. No per-chunk guard: the callers' outer try covers
 *  enqueue failures, as before. Callers MUST await (emits would otherwise
 *  race the persistence tail). Still a separate primitive from
 *  readProviderStream by design (B12) — never unify the two. */
export async function replayTokenBurst(text: string, emit: (chunk: string) => void) {
  const chunkSize = 20;
  const paceEvery = 5;
  const paceDelayMs = 15;
  const maxTotalDelayMs = 3_000;
  let delaysLeft = Math.floor(maxTotalDelayMs / paceDelayMs);

  let sinceYield = 0;
  for (let i = 0; i < text.length; i += chunkSize) {
    emit(text.slice(i, i + chunkSize));
    sinceYield++;
    if (sinceYield >= paceEvery && delaysLeft > 0) {
      sinceYield = 0;
      delaysLeft--;
      await new Promise((resolve) => setTimeout(resolve, paceDelayMs));
    }
  }
}
