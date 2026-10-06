// Hook-level pins for useChatMessages' failure paths. The chat function
// reports a failure through the `error` field of its done event (a provider
// error on the final call, the persistence warning); that text must reach
// the chat as a bubble, with the user's message kept. It never did: the SSE
// consumer routed error events past the done handler (2026-03 → 2026-10). A
// connection drop keeps the generic bubble.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "token" } } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

import { useChatMessages } from "../useChatMessages";

/** A streamed chat response made of the given JSON events. */
function sseResponse(...events: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${e}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function sendAgainst(res: Response) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(res)));
  const { result } = renderHook(() => useChatMessages("t1"));
  // Let the mount-time message fetch settle before the send.
  await act(async () => {});
  await act(async () => {
    await result.current.sendMessage("hello", false);
  });
  return result;
}

describe("useChatMessages failure paths", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a server-reported error becomes a bubble with the server's text, the question kept", async () => {
    const result = await sendAgainst(sseResponse('{"done":true,"error":"Provider says no"}'));
    expect(result.current.messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "hello"],
      ["assistant", "Provider says no"],
    ]);
    expect(result.current.sending).toBe(false);
  });

  it("a stream that drops without done keeps the generic bubble", async () => {
    const result = await sendAgainst(sseResponse('{"token":"par"}'));
    expect(result.current.messages.map((m) => m.content)).toEqual([
      "hello",
      "Sorry, something went wrong. Please try again.",
    ]);
  });

  it("control: a done event with rows replaces the optimistic message", async () => {
    const user = { id: "u1", thread_id: "t1", role: "user", content: "hello" };
    const assistant = { id: "a1", thread_id: "t1", role: "assistant", content: "hi there" };
    const result = await sendAgainst(
      sseResponse('{"token":"hi there"}', JSON.stringify({ done: true, user_message: user, assistant_message: assistant })),
    );
    expect(result.current.messages.map((m) => m.id)).toEqual(["u1", "a1"]);
  });
});
