/**
 * Shared SSE (Server-Sent Events) parsing utility.
 *
 * Used by chat, context-prompt (Ask/Propose), and editor-action consumers
 * to read streaming responses from edge functions.
 */

/**
 * SSE line parser: accumulates partial chunks, yields complete `data:` payloads.
 */
export function createSSEParser() {
  let buffer = "";
  return {
    /** Feed raw text from the stream; returns parsed JSON events. */
    feed(chunk: string): Array<Record<string, unknown>> {
      buffer += chunk;
      const events: Array<Record<string, unknown>> = [];
      // Split on double-newline (SSE event boundary)
      const parts = buffer.split("\n\n");
      // Last part may be incomplete — keep in buffer
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            events.push(JSON.parse(payload));
          } catch {
            // skip malformed
          }
        }
      }
      return events;
    },
  };
}

/**
 * Higher-level SSE stream consumer. Reads a ReadableStream, parses SSE events,
 * and dispatches to callbacks.
 *
 * @returns Promise that resolves when the stream ends (whether or not `done` was received).
 */
export async function consumeSSEStream(
  body: ReadableStream<Uint8Array>,
  callbacks: {
    onToken: (text: string) => void;
    onPhase?: (phase: string) => void;
    onDone: (data: Record<string, unknown>) => void;
    onError?: (err: Error) => void;
  }
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSSEParser();
  let receivedDone = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const events = parser.feed(chunk);

      for (const evt of events) {
        if (evt.error) {
          callbacks.onError?.(new Error(evt.error as string));
          continue;
        }
        if (evt.phase && typeof evt.phase === "string") {
          callbacks.onPhase?.(evt.phase);
        }
        if (evt.token && typeof evt.token === "string") {
          callbacks.onToken(evt.token);
        }
        if (evt.done === true) {
          receivedDone = true;
          callbacks.onDone(evt);
        }
      }
    }
  } catch (streamErr) {
    callbacks.onError?.(streamErr instanceof Error ? streamErr : new Error(String(streamErr)));
  }

  if (!receivedDone) {
    callbacks.onError?.(new Error("Stream ended without done event"));
  }
}
