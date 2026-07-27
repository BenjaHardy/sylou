// Deno unit tests for the shared SSE streaming primitives.
// Run with: deno test supabase/functions/_shared/_sse.test.ts
//
// These pin the exact semantics the five former reader-loop copies
// shared (P4-1 Phase B map) — including the deliberate quirks. A red
// test here means the §7 streaming contract changed; that needs a
// checkpoint, not a test edit.
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { makeSSEHelpers, readProviderStream, replayTokenBurst } from "./_sse.ts";

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

Deno.test("readProviderStream: [DONE] fires the marker and CONTINUES — later deltas still stream", async () => {
  let markers = 0;
  const tokens: string[] = [];
  const result = await readProviderStream(
    sseResponse([openaiDelta("a"), "data: [DONE]\n", openaiDelta("b")]),
    "mistral",
    { onToken: (d) => tokens.push(d), onDoneMarker: () => markers++ },
  );
  assertEquals(markers, 1);
  assertEquals(tokens, ["a", "b"]);
  assertEquals(result, "ab");
});

Deno.test("readProviderStream: [DONE] without a marker callback is a no-op", async () => {
  const result = await readProviderStream(
    sseResponse(["data: [DONE]\n", openaiDelta("x")]),
    "anthropic",
    { onToken: () => {} },
  );
  assertEquals(result, "x");
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
