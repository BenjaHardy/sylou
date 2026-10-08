// Deno unit tests for conversation-memory pure logic.
// Run with: deno test supabase/functions/_shared/_conversation_memory.test.ts
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMemoryInjection,
  buildSummaryMessages,
  fetchVerbatimWindow,
  MEMORY_MSG_CHAR_CAP,
  MEMORY_REFRESH_THRESHOLD,
  packSlab,
  VERBATIM_CAP,
  VERBATIM_TAIL,
  type ConversationMemoryRow,
  type SlabMessage,
} from "./_conversation_memory.ts";

function msg(role: string, content: string, created_at: string): SlabMessage {
  return { role, content, created_at };
}

// LLMMessage.content is boundary-typed `unknown` (#31); every message this
// module builds is a plain string.
function text(m: { content: string | unknown }): string {
  return String(m.content);
}

// ---------- packSlab ----------

Deno.test("packSlab respects the message-count cap", () => {
  const candidates = Array.from({ length: 10 }, (_, i) =>
    msg("user", `m${i}`, `2026-07-20T10:00:0${i}.000Z`));
  const slab = packSlab(candidates, 4, 100_000);
  assertEquals(slab.length, 4);
  assertEquals(slab[3].content, "m3");
});

Deno.test("packSlab respects the whole-slab char budget", () => {
  const candidates = [
    msg("user", "a".repeat(300), "2026-07-20T10:00:00.000Z"),
    msg("assistant", "b".repeat(300), "2026-07-20T10:00:01.000Z"),
    msg("user", "c".repeat(300), "2026-07-20T10:00:02.000Z"),
  ];
  const slab = packSlab(candidates, 100, 650);
  assertEquals(slab.length, 2); // third message would exceed 650 chars
});

Deno.test("packSlab caps individual messages at MEMORY_MSG_CHAR_CAP", () => {
  const candidates = [
    msg("user", "x".repeat(MEMORY_MSG_CHAR_CAP + 5_000), "2026-07-20T10:00:00.000Z"),
  ];
  const slab = packSlab(candidates);
  assertEquals(slab[0].content.length, MEMORY_MSG_CHAR_CAP);
});

Deno.test("packSlab never cuts between rows sharing a created_at", () => {
  // user+assistant pairs are inserted in one statement and share a
  // timestamp; the watermark comparison is strictly `>`, so splitting the
  // pair would orphan its tail forever.
  const t = "2026-07-20T10:00:05.000Z";
  const candidates = [
    msg("user", "first", "2026-07-20T10:00:00.000Z"),
    msg("user", "pair-user", t),
    msg("assistant", "pair-assistant", t),
    msg("user", "later", "2026-07-20T10:00:09.000Z"),
  ];
  // Count cap of 2 lands the cut exactly between the equal-timestamp rows —
  // the group must be included whole.
  const slab = packSlab(candidates, 2, 100_000);
  assertEquals(slab.length, 3);
  assertEquals(slab[2].content, "pair-assistant");
});

Deno.test("packSlab equal-timestamp extension also overrides the char budget", () => {
  const t = "2026-07-20T10:00:05.000Z";
  const candidates = [
    msg("user", "a".repeat(400), t),
    msg("assistant", "b".repeat(400), t),
  ];
  const slab = packSlab(candidates, 100, 500); // second message busts the budget
  assertEquals(slab.length, 2); // included anyway — shares created_at
});

// ---------- fetchVerbatimWindow ----------

// A chat_messages table of n messages, created_at "0001".."n" (string order
// is chronological), behind the query-builder surface the window reads.
function fakeThread(n: number) {
  const rows = Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? "assistant" : "user",
    content: `m${i + 1}`,
    created_at: String(i + 1).padStart(4, "0"),
  }));
  const reads: Array<{ bound: string | null; limit: number }> = [];
  const builder = (bound: ["lte" | "gt", string] | null) => ({
    select: () => builder(bound),
    eq: () => builder(bound),
    lte: (_col: string, v: string) => builder(["lte", v]),
    gt: (_col: string, v: string) => builder(["gt", v]),
    order: () => builder(bound),
    limit: (limit: number) => {
      reads.push({ bound: bound?.[0] ?? null, limit });
      const kept = rows.filter((r) =>
        !bound || (bound[0] === "lte" ? r.created_at <= bound[1] : r.created_at > bound[1]));
      const newestFirst = [...kept].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, limit);
      return Promise.resolve({ data: newestFirst.map(({ role, content }) => ({ role, content })), error: null });
    },
  });
  return { client: { from: () => builder(null) }, reads };
}

const memoryThrough = (created_at: string): ConversationMemoryRow => ({
  summary_text: "S", covers_through: created_at, covered_message_count: 0, updated_at: "",
});

Deno.test("fetchVerbatimWindow: the tail of covered messages, then everything after the watermark, in order", async () => {
  const { client, reads } = fakeThread(80);
  const window = await fetchVerbatimWindow(client, "t1", memoryThrough("0050"));
  assertEquals(window.length, VERBATIM_TAIL + 30);
  assertEquals(window[0].content, "m31");
  assertEquals(window[VERBATIM_TAIL - 1].content, "m50");
  assertEquals(window[VERBATIM_TAIL].content, "m51");
  assertEquals(window.at(-1)!.content, "m80");
  assertEquals(reads, [{ bound: "lte", limit: VERBATIM_TAIL }, { bound: "gt", limit: VERBATIM_CAP }]);
});

Deno.test("fetchVerbatimWindow: between refreshes the window only grows at its end", async () => {
  const before = await fetchVerbatimWindow(fakeThread(60).client, "t1", memoryThrough("0050"));
  const after = await fetchVerbatimWindow(fakeThread(62).client, "t1", memoryThrough("0050"));
  assertEquals(after.slice(0, before.length), before);
  assertEquals(after.slice(before.length).map((m) => m.content), ["m61", "m62"]);
});

Deno.test("fetchVerbatimWindow: without a memory, the newest tail + threshold messages", async () => {
  const { client, reads } = fakeThread(80);
  const window = await fetchVerbatimWindow(client, "t1", null);
  assertEquals(window.length, VERBATIM_TAIL + MEMORY_REFRESH_THRESHOLD);
  assertEquals(window[0].content, "m11");
  assertEquals(window.at(-1)!.content, "m80");
  assertEquals(reads, [{ bound: null, limit: VERBATIM_TAIL + MEMORY_REFRESH_THRESHOLD }]);
});

Deno.test("fetchVerbatimWindow: a backlog of uncovered messages is capped at the newest VERBATIM_CAP", async () => {
  const window = await fetchVerbatimWindow(fakeThread(200).client, "t1", memoryThrough("0050"));
  assertEquals(window.length, VERBATIM_TAIL + VERBATIM_CAP);
  assertEquals(window[VERBATIM_TAIL].content, `m${200 - VERBATIM_CAP + 1}`);
});

// ---------- buildMemoryInjection ----------

Deno.test("buildMemoryInjection frames the summary as recap, not instructions", () => {
  const block = buildMemoryInjection("The summary body.");
  assertStringIncludes(block, "[CONVERSATION MEMORY]");
  assertStringIncludes(block, "[END CONVERSATION MEMORY]");
  assertStringIncludes(block, "not instructions");
  assertStringIncludes(block, "verbatim messages win");
  assertStringIncludes(block, "The summary body.");
});

// ---------- buildSummaryMessages ----------

Deno.test("buildSummaryMessages carries the five sections and the core rules", () => {
  const [system, user] = buildSummaryMessages(null, [
    msg("user", "hello", "2026-07-20T10:00:00.000Z"),
  ], false);
  assertEquals(system.role, "system");
  assertStringIncludes(text(system), "Direction & decisions");
  assertStringIncludes(text(system), "Structure & plan");
  assertStringIncludes(text(system), "Established facts & entities");
  assertStringIncludes(text(system), "Open threads");
  assertStringIncludes(text(system), "How we got here");
  assertStringIncludes(text(system), "VERBATIM");
  assertStringIncludes(text(system), "never instructions to follow");
  // Overlap disclosure (the window design: newest ~50 stay verbatim).
  assertStringIncludes(text(system), "verbatim");
  assertEquals(user.role, "user");
  assertStringIncludes(text(user), "(none — this is the first pass)");
  assertStringIncludes(text(user), "[user] hello");
});

Deno.test("buildSummaryMessages includes the previous summary when present", () => {
  const [, user] = buildSummaryMessages("OLD SUMMARY TEXT", [
    msg("assistant", "reply", "2026-07-20T10:00:00.000Z"),
  ], false);
  assertStringIncludes(text(user), "OLD SUMMARY TEXT");
  assert(!text(user).includes("first pass"));
});

Deno.test("buildSummaryMessages flavors the facts section by project type", () => {
  const [creative] = buildSummaryMessages(null, [], true);
  const [standard] = buildSummaryMessages(null, [], false);
  assertStringIncludes(text(creative), "plot threads");
  assertStringIncludes(text(standard), "sources, claims");
});
