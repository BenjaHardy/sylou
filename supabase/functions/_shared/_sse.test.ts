// Deno unit tests for the shared SSE streaming primitives.
// Run with: deno test supabase/functions/_shared/_sse.test.ts
//
// These pin the exact semantics the five former reader-loop copies
// shared (P4-1 Phase B map) — including the deliberate quirks. A red
// test here means the §7 streaming contract changed; that needs a
// checkpoint, not a test edit.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  makeSSEHelpers,
  readProviderStream,
  readProviderStreamWithStats,
  relayProviderStream,
  replayTokenBurst,
  startKeepalive,
  type StreamStats,
} from "./_sse.ts";
import { isTruncatedStop } from "./_llm.ts";

// ── helpers ──────────────────────────────────────────────────────────

const enc = new TextEncoder();

/** Build a Response whose body enqueues each chunk as one read. */
function sseResponse(chunks: (string | Uint8Array)[]): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) {
          controller.enqueue(typeof c === "string" ? enc.encode(c) : c);
        }
        controller.close();
      },
    }),
  );
}

function openaiDelta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`;
}

// ── readProviderStream ───────────────────────────────────────────────

Deno.test("readProviderStream: forwards deltas in order and returns the raw concatenation", async () => {
  const tokens: string[] = [];
  const result = await readProviderStream(
    sseResponse([openaiDelta("Hel"), openaiDelta("lo")]),
    "mistral",
    { onToken: (d) => tokens.push(d) },
  );
  assertEquals(tokens, ["Hel", "lo"]);
  assertEquals(result, "Hello");
});

Deno.test("readProviderStream: reassembles a data line split across reads", async () => {
  const line = openaiDelta("split-safe");
  const tokens: string[] = [];
  const result = await readProviderStream(
    sseResponse([line.slice(0, 15), line.slice(15)]),
    "mistral",
    { onToken: (d) => tokens.push(d) },
  );
  assertEquals(tokens, ["split-safe"]);
  assertEquals(result, "split-safe");
});

Deno.test("readProviderStream: multi-byte character split across byte chunks survives", async () => {
  const bytes = enc.encode(openaiDelta("🌊ok"));
  const result = await readProviderStream(
    sseResponse([bytes.slice(0, 12), bytes.slice(12)]),
    "mistral",
    { onToken: () => {} },
  );
  assertEquals(result, "🌊ok");
});

Deno.test("readProviderStream: [DONE] is skipped and CONTINUES — later deltas still stream", async () => {
  const tokens: string[] = [];
  const result = await readProviderStream(
    sseResponse([openaiDelta("a"), "data: [DONE]\n", openaiDelta("b")]),
    "mistral",
    { onToken: (d) => tokens.push(d) },
  );
  assertEquals(tokens, ["a", "b"]);
  assertEquals(result, "ab");
});

Deno.test("readProviderStream: malformed JSON and non-data lines are skipped without dying", async () => {
  const result = await readProviderStream(
    sseResponse([
      "data: {not json}\n",
      ": comment\n",
      "event: ping\n",
      "\n",
      openaiDelta("ok"),
    ]),
    "mistral",
    { onToken: () => {} },
  );
  assertEquals(result, "ok");
});

Deno.test("readProviderStream: empty-string deltas are filtered (not forwarded, not accumulated)", async () => {
  const tokens: string[] = [];
  const result = await readProviderStream(
    sseResponse([
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "" } })}\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })}\n`,
    ]),
    "anthropic",
    { onToken: (d) => tokens.push(d) },
  );
  assertEquals(tokens, ["hi"]);
  assertEquals(result, "hi");
});

Deno.test("readProviderStream: a trailing line without \\n is deliberately dropped (pre-extraction behavior)", async () => {
  const result = await readProviderStream(
    // second line has no trailing newline — its data never surfaces
    sseResponse([openaiDelta("kept"), openaiDelta("dropped").trimEnd()]),
    "mistral",
    { onToken: () => {} },
  );
  assertEquals(result, "kept");
});

Deno.test("readProviderStream: Mistral reasoning array deltas join only the text chunks", async () => {
  const result = await readProviderStream(
    sseResponse([
      `data: ${
        JSON.stringify({
          choices: [{
            delta: {
              content: [
                { type: "thinking", thinking: [{ type: "text", text: "hmm" }] },
                { type: "text", text: "Hel" },
                { type: "text", text: "lo" },
              ],
            },
          }],
        })
      }\n`,
    ]),
    "mistral",
    { onToken: () => {} },
  );
  assertEquals(result, "Hello");
});

Deno.test("readProviderStream: a throwing onToken is contained by the per-line guard, loop survives", async () => {
  let calls = 0;
  const result = await readProviderStream(
    sseResponse([openaiDelta("a"), openaiDelta("b")]),
    "mistral",
    {
      onToken: () => {
        calls++;
        if (calls === 1) throw new Error("client gone and unguarded");
      },
    },
  );
  // First delta accumulated before the throw; second processed normally.
  assertEquals(calls, 2);
  assertEquals(result, "ab");
});

// ── makeSSEHelpers ───────────────────────────────────────────────────

Deno.test("sseEvent: exact wire frame `data: <json>\\n\\n`", () => {
  const { sseEvent } = makeSSEHelpers({});
  assertEquals(
    new TextDecoder().decode(sseEvent({ token: "hi" })),
    'data: {"token":"hi"}\n\n',
  );
});

Deno.test("createSSEResponse: the five SSE headers plus the caller's CORS headers", () => {
  const { createSSEResponse } = makeSSEHelpers({
    "Access-Control-Allow-Origin": "https://example.test",
  });
  const res = createSSEResponse(new ReadableStream());
  assertEquals(res.headers.get("Content-Type"), "text/event-stream");
  assertEquals(res.headers.get("Cache-Control"), "no-cache");
  assertEquals(res.headers.get("X-Accel-Buffering"), "no");
  assertEquals(res.headers.get("Connection"), "keep-alive");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "https://example.test");
  assertEquals(res.status, 200);
});

// ── replayTokenBurst ─────────────────────────────────────────────────

Deno.test("replayTokenBurst: 20-char chunks in order, remainder last", async () => {
  const chunks: string[] = [];
  await replayTokenBurst("a".repeat(20) + "b".repeat(20) + "tail", (c) => chunks.push(c));
  assertEquals(chunks, ["a".repeat(20), "b".repeat(20), "tail"]);
});

Deno.test("replayTokenBurst: paces long text without losing or reordering content", async () => {
  // 240 chars = 12 chunks -> two 15ms pacing yields (after chunks 5 and 10).
  const text = Array.from({ length: 240 }, (_, i) => String.fromCharCode(97 + (i % 26))).join("");
  const chunks: string[] = [];
  const started = performance.now();
  await replayTokenBurst(text, (c) => chunks.push(c));
  const elapsed = performance.now() - started;
  assertEquals(chunks.length, 12);
  assertEquals(chunks.join(""), text);
  // Timers only fire late, never early: two 15ms yields => >= ~25ms.
  assert(elapsed >= 25, `expected pacing delays, got ${elapsed}ms`);
});

Deno.test("replayTokenBurst: empty text emits nothing", async () => {
  let called = false;
  await replayTokenBurst("", () => {
    called = true;
  });
  assert(!called);
});

// ── stop-reason reporting (2026-09, large-selection safety) ───────────

Deno.test("readProviderStream: reports an OpenAI-shape finish_reason through onStop", async () => {
  const stops: string[] = [];
  const last = `data: ${JSON.stringify({ choices: [{ delta: { content: "!" }, finish_reason: "length" }] })}\n`;
  const result = await readProviderStream(
    sseResponse([openaiDelta("cut"), last, "data: [DONE]\n"]),
    "mistral",
    { onToken: () => {}, onStop: (r) => stops.push(r) },
  );
  assertEquals(result, "cut!");
  assertEquals(stops, ["length"]);
});

Deno.test("readProviderStream: reports Anthropic's message_delta stop_reason through onStop", async () => {
  const stops: string[] = [];
  const chunks = [
    `data: ${JSON.stringify({ type: "content_block_delta", delta: { text: "cut" } })}\n`,
    `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens", stop_sequence: null }, usage: { output_tokens: 1000 } })}\n`,
    `data: ${JSON.stringify({ type: "message_stop" })}\n`,
  ];
  const result = await readProviderStream(sseResponse(chunks), "anthropic", {
    onToken: () => {},
    onStop: (r) => stops.push(r),
  });
  assertEquals(result, "cut");
  assertEquals(stops, ["max_tokens"]);
});

Deno.test("readProviderStream: without onStop the loop is unchanged; isTruncatedStop maps only length/max_tokens", async () => {
  const last = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n`;
  const result = await readProviderStream(sseResponse([openaiDelta("done"), last]), "mistral", { onToken: () => {} });
  assertEquals(result, "done");
  assertEquals(isTruncatedStop("stop"), false);
  assertEquals(isTruncatedStop("end_turn"), false);
  assertEquals(isTruncatedStop("length"), true);
  assertEquals(isTruncatedStop("max_tokens"), true);
  assertEquals(isTruncatedStop(null), false);
});

Deno.test("readProviderStream: onThinking fires once, at the first reasoning chunk; text still streams and reasoning never accumulates", async () => {
  const thinkingChunk = `data: ${
    JSON.stringify({ choices: [{ delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "…" }] }] } }] })
  }\n`;
  let fired = 0;
  const tokens: string[] = [];
  const result = await readProviderStream(
    sseResponse([thinkingChunk, thinkingChunk, openaiDelta("an"), thinkingChunk, openaiDelta("swer")]),
    "mistral",
    { onToken: (d) => tokens.push(d), onThinking: () => { fired++; } },
  );
  assertEquals(fired, 1);
  assertEquals(tokens, ["an", "swer"]);
  assertEquals(result, "answer");
});

Deno.test("readProviderStream: onEnd reports what arrived by kind and how the stream ended", async () => {
  const thinkingChunk = `data: ${
    JSON.stringify({ choices: [{ delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "…" }] }] } }] })
  }\n`;
  const last = `data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: "length" }], usage: { completion_tokens: 3 } })}\n`;
  let stats: StreamStats | null = null;
  const result = await readProviderStream(
    sseResponse([thinkingChunk, thinkingChunk, openaiDelta("an"), openaiDelta("swer"), last, "data: [DONE]\n"]),
    "mistral",
    { onToken: () => {}, onEnd: (s) => { stats = s; } },
  );
  assertEquals(result, "answer");
  const s = stats!;
  assertEquals([s.chunks, s.thinking, s.text, s.finish, s.sawDone], [5, 2, 2, "length", true]);
  assertEquals(s.lastKeys, ["choices", "usage"]);
  assertEquals(s.providerError, null);
  assert(s.ms >= 0);
});

Deno.test("readProviderStream: onEnd keeps a provider error object (its wording only) and records a stream that ended without a finish reason", async () => {
  const err = `data: ${JSON.stringify({ error: { type: "server_error", message: "upstream reset", request_id: "r1" } })}\n`;
  let stats: StreamStats | null = null;
  const result = await readProviderStream(sseResponse([openaiDelta("partial"), err]), "mistral", {
    onToken: () => {},
    onEnd: (s) => { stats = s; },
  });
  assertEquals(result, "partial");
  const s = stats!;
  assertEquals([s.chunks, s.text, s.finish, s.sawDone], [2, 1, null, false]);
  assertEquals(s.lastKeys, ["error"]);
  assertEquals(s.providerError, { type: "server_error", message: "upstream reset" });
});

Deno.test("readProviderStream: Anthropic usage is merged from message_start (prompt side, cache fields) and message_delta (output)", async () => {
  const start = `data: ${JSON.stringify({
    type: "message_start",
    message: { usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 80, output_tokens: 1 } },
  })}\n`;
  const text = `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "hi" } })}\n`;
  const end = `data: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } })}\n`;
  let stats: StreamStats | null = null;
  await readProviderStream(sseResponse([start, text, end]), "anthropic", {
    onToken: () => {},
    onEnd: (s) => { stats = s; },
  });
  assertEquals(stats!.usage, { input_tokens: 100, output_tokens: 7, cache_read_tokens: 80, cache_write_tokens: 20 });
});

Deno.test("readProviderStream: OpenAI-shape usage comes from the final chunk, cached tokens included", async () => {
  const last = `data: ${JSON.stringify({
    choices: [{ delta: { content: "" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 300, completion_tokens: 12, prompt_tokens_details: { cached_tokens: 256 } },
  })}\n`;
  let stats: StreamStats | null = null;
  await readProviderStream(sseResponse([openaiDelta("ok"), last, "data: [DONE]\n"]), "mistral", {
    onToken: () => {},
    onEnd: (s) => { stats = s; },
  });
  assertEquals(stats!.usage, { input_tokens: 300, output_tokens: 12, cache_read_tokens: 256 });
});

Deno.test("startKeepalive: ticks on the interval and stops when told", async () => {
  let ticks = 0;
  const stop = startKeepalive(() => { ticks++; }, 5);
  // Timer granularity varies; wait long enough for at least two ticks.
  await new Promise((r) => setTimeout(r, 80));
  stop();
  const seen = ticks;
  assert(seen >= 2, `expected at least two ticks, saw ${seen}`);
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(ticks, seen);
});

Deno.test("makeSSEHelpers: the keep-alive is an SSE comment line, which our own client parser skips", () => {
  const { sseKeepalive } = makeSSEHelpers({});
  assertEquals(new TextDecoder().decode(sseKeepalive()), ": keep-alive\n\n");
});

/** A controller stand-in that records enqueued frames; `broken` throws like a gone client. */
function fakeController(broken = false) {
  const frames: string[] = [];
  const dec = new TextDecoder();
  const controller = {
    enqueue(bytes: Uint8Array) {
      if (broken) throw new TypeError("Invalid state: Controller is already closed");
      frames.push(dec.decode(bytes));
    },
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, frames };
}

Deno.test("relayProviderStream: tokens become {token} frames, one {phase:thinking} precedes them, nothing else is forwarded", async () => {
  const { sseEvent } = makeSSEHelpers({});
  const thinkingChunk = `data: ${
    JSON.stringify({ choices: [{ delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "…" }] }] } }] })
  }\n`;
  const last = `data: ${JSON.stringify({ choices: [{ delta: { content: "" }, finish_reason: "length" }] })}\n`;
  const { controller, frames } = fakeController();
  const relay = await relayProviderStream(
    sseResponse([thinkingChunk, thinkingChunk, openaiDelta("an"), openaiDelta("swer"), last, "data: [DONE]\n"]),
    "mistral",
    controller,
    sseEvent,
  );
  assertEquals(frames, [
    'data: {"phase":"thinking"}\n\n',
    'data: {"token":"an"}\n\n',
    'data: {"token":"swer"}\n\n',
  ]);
  assertEquals(relay.text, "answer");
  assertEquals(relay.stopReason, "length");
  assertEquals([relay.stats.chunks, relay.stats.thinking, relay.stats.text, relay.stats.sawDone], [5, 2, 2, true]);
});

Deno.test("relayProviderStream: a gone client (enqueue throws) never breaks the read; text and stats still come back", async () => {
  const { sseEvent } = makeSSEHelpers({});
  const { controller } = fakeController(true);
  const relay = await relayProviderStream(sseResponse([openaiDelta("still "), openaiDelta("read")]), "mistral", controller, sseEvent);
  assertEquals(relay.text, "still read");
  assertEquals(relay.stopReason, null);
  assertEquals(relay.stats.text, 2);
});

Deno.test("readProviderStreamWithStats returns what readProviderStream reports through onEnd", async () => {
  let viaCallback = null as StreamStats | null;
  const chunks = [openaiDelta("a"), openaiDelta("b"), "data: [DONE]\n"];
  const text1 = await readProviderStream(sseResponse(chunks), "mistral", { onToken: () => {}, onEnd: (s) => { viaCallback = s; } });
  const { text: text2, stats } = await readProviderStreamWithStats(sseResponse(chunks), "mistral", { onToken: () => {} });
  assertEquals(text1, "ab");
  assertEquals(text2, "ab");
  assert(viaCallback !== null);
  assertEquals([viaCallback.chunks, viaCallback.text, viaCallback.sawDone], [stats.chunks, stats.text, stats.sawDone]);
});

Deno.test("makeSSEHelpers.keepAlive: writes the comment on each tick, stops when told, and survives a gone client", async () => {
  const { keepAlive } = makeSSEHelpers({});
  const live = fakeController();
  const gone = fakeController(true);
  const stopLive = keepAlive(live.controller, 5);
  const stopGone = keepAlive(gone.controller, 5);
  await new Promise((r) => setTimeout(r, 80));
  stopLive();
  stopGone();
  const seen = live.frames.length;
  assert(seen >= 2, `expected at least two keep-alives, saw ${seen}`);
  assert(live.frames.every((f) => f === ": keep-alive\n\n"));
  await new Promise((r) => setTimeout(r, 30));
  assertEquals(live.frames.length, seen);
});

Deno.test("readProviderStream: without onThinking, reasoning chunks are skipped exactly as before (Anthropic shape)", async () => {
  const thinkingChunk = `data: ${
    JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "…" } })
  }\n`;
  const text = `data: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } })}\n`;
  const result = await readProviderStream(sseResponse([thinkingChunk, text]), "anthropic", { onToken: () => {} });
  assertEquals(result, "ok");
});
