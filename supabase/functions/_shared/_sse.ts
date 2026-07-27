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
// events, done/error payload construction, enqueue-guard styles
// (per-event try/catch vs editor-action's clientDisconnected latch),
// stream-first persistence tails, and controller.close() placement.

import { extractDeltaText, type ProviderId } from "./_llm.ts";

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

  return { sseEvent, createSSEResponse };
}

/**
 * Read a provider's SSE response and hand each text delta to the caller.
 * Returns the RAW accumulated text — cleaning (cleanLLMContent), trimming
 * and fallback strings are caller policy, not loop mechanics.
 *
 * Contract, pinned by _sse.test.ts (all five former copies behaved this
 * way — do not "improve" without a checkpoint):
 *   - `[DONE]` fires onDoneMarker (every occurrence) and CONTINUES; the
 *     loop only exits when the reader reports done.
 *   - Deltas are filtered by truthiness: empty-string deltas are neither
 *     accumulated nor forwarded.
 *   - onToken owns the enqueue and its own disconnect-guard style; it is
 *     called inside the per-line try, so a throwing malformed chunk (or
 *     a caller guard that swallows) never kills the loop.
 *   - No final decoder flush: a trailing line not terminated by \n is
 *     deliberately dropped, exactly as before the extraction.
 *   - res.body!.getReader() is acquired here; callers must await inside
 *     their existing try so a null body lands in the same catch as before.
 */
export async function readProviderStream(
  res: Response,
  provider: ProviderId,
  handlers: {
    onToken: (delta: string) => void;
    onDoneMarker?: () => void;
  },
): Promise<string> {
  let fullResponse = "";
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
        handlers.onDoneMarker?.();
        continue;
      }

      try {
        const parsed = JSON.parse(payload);
        const delta = extractDeltaText(parsed, provider);
        if (delta) {
          fullResponse += delta;
          handlers.onToken(delta);
        }
      } catch { /* skip malformed chunk */ }
    }
  }

  return fullResponse;
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
