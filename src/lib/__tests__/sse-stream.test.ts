// Tests for the shared client-side SSE consumer (P4-5).
//
// sse-stream.ts is the single consumer for every stream in the app (chat,
// context-prompt Ask/Propose, editor-action) and re-implements the classic
// SSE hazards: events split across network chunks, multi-byte characters
// split across chunk boundaries, malformed payloads, streams that die
// without a `done`. Each hazard gets a test here.
import { describe, it, expect } from "vitest";
import { createSSEParser, consumeSSEStream } from "@/lib/sse-stream";

// ---------- createSSEParser ----------

describe("createSSEParser", () => {
  it("parses a single complete data event", () => {
    const p = createSSEParser();
    expect(p.feed('data: {"token":"hi"}\n\n')).toEqual([{ token: "hi" }]);
  });

  it("parses multiple events arriving in one chunk", () => {
    const p = createSSEParser();
    const events = p.feed('data: {"token":"a"}\n\ndata: {"token":"b"}\n\n');
    expect(events).toEqual([{ token: "a" }, { token: "b" }]);
  });

  it("buffers an event split across feeds (the classic SSE bug class)", () => {
    const p = createSSEParser();
    expect(p.feed('data: {"tok')).toEqual([]);
    expect(p.feed('en":"split"}\n')).toEqual([]);
    expect(p.feed("\n")).toEqual([{ token: "split" }]);
  });

  it("keeps a trailing partial event in the buffer across complete ones", () => {
    const p = createSSEParser();
    const first = p.feed('data: {"token":"done-part"}\n\ndata: {"tok');
    expect(first).toEqual([{ token: "done-part" }]);
    expect(p.feed('en":"later"}\n\n')).toEqual([{ token: "later" }]);
  });

  it("skips [DONE] sentinels and malformed JSON without dying", () => {
    const p = createSSEParser();
    const events = p.feed(
      'data: [DONE]\n\ndata: {not json}\n\ndata: {"token":"ok"}\n\n',
    );
    expect(events).toEqual([{ token: "ok" }]);
  });

  it("ignores non-data lines (comments, event names, blank lines)", () => {
    const p = createSSEParser();
    const events = p.feed(': keepalive\nevent: message\ndata: {"token":"x"}\n\n');
    expect(events).toEqual([{ token: "x" }]);
  });
});

// ---------- consumeSSEStream ----------

function streamOfText(...chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}

function streamOfBytes(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(ch);
      c.close();
    },
  });
}

type Recorded = { tokens: string[]; phases: string[]; done: Record<string, unknown>[]; errors: string[] };

async function consume(body: ReadableStream<Uint8Array>): Promise<Recorded> {
  const rec: Recorded = { tokens: [], phases: [], done: [], errors: [] };
  await consumeSSEStream(body, {
    onToken: (t) => rec.tokens.push(t),
    onPhase: (p) => rec.phases.push(p),
    onDone: (d) => rec.done.push(d),
    onError: (e) => rec.errors.push(e.message),
  });
  return rec;
}

describe("consumeSSEStream", () => {
  it("dispatches tokens, phases and done in order", async () => {
    const rec = await consume(
      streamOfText(
        'data: {"phase":"reviewing"}\n\n',
        'data: {"token":"Hel"}\n\ndata: {"token":"lo"}\n\n',
        'data: {"done":true,"budget_remaining":42}\n\n',
      ),
    );
    expect(rec.phases).toEqual(["reviewing"]);
    expect(rec.tokens).toEqual(["Hel", "lo"]);
    expect(rec.done).toEqual([{ done: true, budget_remaining: 42 }]);
    expect(rec.errors).toEqual([]);
  });

  it("delivers the full done payload to the callback", async () => {
    const payload = { done: true, user_message: { id: "u1" }, assistant_message: { id: "a1" } };
    const rec = await consume(streamOfText(`data: ${JSON.stringify(payload)}\n\n`));
    expect(rec.done[0]).toEqual(payload);
  });

  it("reassembles an event split across network chunks", async () => {
    const rec = await consume(
      streamOfText('data: {"token":"sp', 'lit"}\n\n', 'data: {"done":true}\n\n'),
    );
    expect(rec.tokens).toEqual(["split"]);
    expect(rec.errors).toEqual([]);
  });

  it("survives a multi-byte character split across byte chunks", async () => {
    const enc = new TextEncoder();
    const bytes = enc.encode('data: {"token":"🙂"}\n\ndata: {"done":true}\n\n');
    // Cut inside the emoji's 4-byte UTF-8 sequence.
    const cut = 'data: {"token":"'.length + 2;
    const rec = await consume(streamOfBytes(bytes.slice(0, cut), bytes.slice(cut)));
    expect(rec.tokens).toEqual(["🙂"]);
    expect(rec.errors).toEqual([]);
  });

  it("routes error events to onError and keeps consuming", async () => {
    const rec = await consume(
      streamOfText('data: {"error":"boom"}\n\ndata: {"done":true}\n\n'),
    );
    expect(rec.errors).toEqual(["boom"]);
    expect(rec.done).toHaveLength(1);
  });

  it("reports a stream that ends without done", async () => {
    const rec = await consume(streamOfText('data: {"token":"orphan"}\n\n'));
    expect(rec.tokens).toEqual(["orphan"]);
    expect(rec.errors).toEqual(["Stream ended without done event"]);
  });

  it("reports a mid-stream reader failure via onError (and the missing done)", async () => {
    // pull()-based so the first chunk is actually delivered before the
    // failure (erroring in start() would discard the queued chunk).
    let pulls = 0;
    const failing = new ReadableStream<Uint8Array>({
      pull(c) {
        if (pulls++ === 0) c.enqueue(new TextEncoder().encode('data: {"token":"pre"}\n\n'));
        else c.error(new Error("network dropped"));
      },
    });
    const rec = await consume(failing);
    expect(rec.tokens).toEqual(["pre"]);
    // Both the stream failure and the missing-done are reported — deliberate.
    expect(rec.errors).toEqual(["network dropped", "Stream ended without done event"]);
  });
});
