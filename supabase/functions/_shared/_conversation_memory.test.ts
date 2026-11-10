// Deno unit tests for conversation-memory pure logic.
// Run with: deno test supabase/functions/_shared/_conversation_memory.test.ts
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMemoryInjection,
  buildSummaryMessages,
  CLOUD_MEMORY,
  fetchVerbatimWindow,
  localMemoryProfile,
  maybeRefreshConversationMemory,
  MEMORY_MAX_SLAB,
  MEMORY_MSG_CHAR_CAP,
  MEMORY_REFRESH_THRESHOLD,
  MEMORY_SLAB_CHAR_BUDGET,
  MEMORY_STORED_CHAR_CAP,
  packSlab,
  VERBATIM_CAP,
  VERBATIM_TAIL,
  type ConversationMemoryRow,
  type MemoryProfile,
  type SlabMessage,
} from "./_conversation_memory.ts";
import { estimatePromptTokens } from "./_fit.ts";
import {
  type DbCall,
  type DbResult,
  fakeBackend,
  fakeProvider,
  jsonReply,
  LOCAL_MODEL,
  TEST_ENV,
  writes,
} from "./_test_support.ts";

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

// ---------- memory profiles ----------

Deno.test("cloud memory: today's numbers, unchanged", () => {
  assertEquals(CLOUD_MEMORY, { refreshThreshold: 50, verbatimTail: 20, storedCharCap: 12_000 });
  assertEquals(
    [MEMORY_MAX_SLAB, MEMORY_SLAB_CHAR_BUDGET, MEMORY_MSG_CHAR_CAP, MEMORY_STORED_CHAR_CAP, VERBATIM_CAP],
    [120, 48_000, 4_000, 12_000, 100],
  );
  const [system] = buildSummaryMessages(null, [], false);
  assertStringIncludes(text(system), "ALSO receives the newest ~50 messages verbatim");
  assertStringIncludes(text(system), "Keep the whole memory under 600 words (hard ceiling 900).");
  assertEquals(buildSummaryMessages("Old.", [], true, CLOUD_MEMORY), buildSummaryMessages("Old.", [], true));
});

Deno.test("local memory: a refresh every 20 messages from a 16k window, every 10 below; 5 kept verbatim", () => {
  assertEquals(localMemoryProfile(8_192), { refreshThreshold: 10, verbatimTail: 5, storedCharCap: 3_072, contextTokens: 8_192 });
  assertEquals(localMemoryProfile(16_384), { refreshThreshold: 20, verbatimTail: 5, storedCharCap: 6_144, contextTokens: 16_384 });
  // The summary takes an eighth of the window, never more than a cloud model's.
  assertEquals(localMemoryProfile(32_768).storedCharCap, MEMORY_STORED_CHAR_CAP);
});

Deno.test("local memory: the summarizer asks for a length that fits the smaller cap", () => {
  const [system] = buildSummaryMessages(null, [], false, localMemoryProfile(8_192));
  assertStringIncludes(text(system), "ALSO receives the newest ~10 messages verbatim");
  assertStringIncludes(text(system), "Keep the whole memory under 150 words (hard ceiling 230).");
});

Deno.test("fetchVerbatimWindow: a local model keeps 5 covered messages, and 5 + its threshold without a memory", async () => {
  const profile = localMemoryProfile(8_192);
  const withMemory = await fetchVerbatimWindow(fakeThread(80).client, "t1", memoryThrough("0050"), profile);
  assertEquals(withMemory.length, 5 + 30);
  assertEquals(withMemory[0].content, "m46");
  const { client, reads } = fakeThread(80);
  const withoutMemory = await fetchVerbatimWindow(client, "t1", null, profile);
  assertEquals(withoutMemory.length, 5 + 10);
  assertEquals(reads, [{ bound: null, limit: 15 }]);
});

Deno.test("packSlab: a size function measures the budget, a local model's tokens for instance", () => {
  const candidates = Array.from({ length: 5 }, (_, i) => msg("user", "x".repeat(30), `2026-07-20T10:00:0${i}.000Z`));
  assertEquals(packSlab(candidates, 100, 25, () => 10).length, 2);
});

// ---------- maybeRefreshConversationMemory ----------

/** A thread whose memory (`previous`, if any) is followed by `uncovered`
 *  messages, in a general project, behind the service-role client. */
function memoryWorld(uncovered: SlabMessage[], previous: ConversationMemoryRow | null) {
  const respond = (call: DbCall): DbResult | undefined => {
    const first = call.steps[0]?.[0];
    switch (call.target) {
      case "chat_thread_summaries":
        if (first === "select") return { data: previous, error: null };
        if (first === "update") return { data: previous ? [{ id: "s-1" }] : [], error: null };
        return { data: null, error: null };
      case "chat_messages":
        return { data: uncovered, error: null };
      case "chat_threads":
        return { data: { project_id: "p-1" }, error: null };
      case "projects":
        return { data: { template: "general" }, error: null };
    }
    return undefined;
  };
  const backend = fakeBackend({ respond });
  const createClient = backend.createClient as unknown as (url: string, key: string) => unknown;
  return { backend, admin: createClient(TEST_ENV.SUPABASE_URL, TEST_ENV.SUPABASE_SERVICE_ROLE_KEY) };
}

/** n messages of about `chars` characters, a minute apart. */
const thread = (n: number, chars = 40) =>
  Array.from({ length: n }, (_, i) =>
    msg(i % 2 ? "assistant" : "user", `${i + 1} ${"w".repeat(chars)}`, `2026-11-10T10:${String(i).padStart(2, "0")}:00.000Z`));

async function refresh(
  uncovered: SlabMessage[],
  opts: { model?: string; profile?: MemoryProfile; force?: boolean; previous?: ConversationMemoryRow; summary?: string } = {},
) {
  const { backend, admin } = memoryWorld(uncovered, opts.previous ?? null);
  const provider = fakeProvider(jsonReply({ content: opts.summary ?? "1. Direction: a short memory." }));
  const refreshed = await maybeRefreshConversationMemory({
    admin,
    threadId: "t-1",
    model: opts.model ?? LOCAL_MODEL,
    userId: "u-1",
    overBudget: false,
    logTag: "[test]",
    profile: opts.profile,
    force: opts.force,
    llm: provider.callLLM,
  });
  const billed = backend.calls.some((c) => c.target === "rpc:increment_tokens_used");
  const stored = writes(backend.calls).find(([, table]) => table === "chat_thread_summaries")?.[2] as
    | Record<string, unknown>
    | undefined;
  return { refreshed, calls: provider.calls, billed, stored };
}

/** The summarizer call fits the window: its prompt, its reply and the margin. */
const fitsWindow = (call: { messages: Parameters<typeof estimatePromptTokens>[0]; max_tokens: number }, window: number) =>
  estimatePromptTokens(call.messages) + call.max_tokens <= window - 256;

Deno.test("refresh, cloud model: at 50 uncovered messages, with the fixed caps, billed", async () => {
  const below = await refresh(thread(49), { model: "mistral-small-2603" });
  assertEquals([below.refreshed, below.calls.length], [false, 0]);
  const { refreshed, calls, billed, stored } = await refresh(thread(50), { model: "mistral-small-2603" });
  assertEquals(refreshed, true);
  assertEquals(calls.map((c) => c.max_tokens), [3_000]);
  assertEquals(billed, true);
  assertEquals(stored?.covered_message_count, 50);
});

Deno.test("refresh, local model: at its threshold, a summarizer call within the window, and nothing billed", async () => {
  const profile = localMemoryProfile(8_192);
  assertEquals((await refresh(thread(9), { profile })).refreshed, false);
  const { refreshed, calls, billed, stored } = await refresh(thread(10), { profile });
  assertEquals(refreshed, true);
  assert(fitsWindow(calls[0], 8_192), String(calls[0].max_tokens));
  assertEquals(billed, false);
  assertEquals(stored?.covered_message_count, 10);
});

Deno.test("refresh, local model: a backlog larger than the window is summarized in part, within the window", async () => {
  const { refreshed, calls, stored } = await refresh(thread(30, 2_000), { profile: localMemoryProfile(8_192) });
  assertEquals(refreshed, true);
  const covered = Number(stored?.covered_message_count);
  assert(covered > 0 && covered < 30, String(covered));
  assert(fitsWindow(calls[0], 8_192));
});

Deno.test("refresh, local model: the stored summary is held to the local cap", async () => {
  const { stored } = await refresh(thread(10), { profile: localMemoryProfile(8_192), summary: "s".repeat(10_000) });
  assertEquals(String(stored?.summary_text).length, 3_072);
});

Deno.test("refresh, forced: below the threshold too; with nothing uncovered, no call", async () => {
  const profile = localMemoryProfile(16_384);
  const forced = await refresh(thread(3), { profile, force: true });
  assertEquals([forced.refreshed, forced.stored?.covered_message_count], [true, 3]);
  const nothing = await refresh([], { profile, force: true });
  assertEquals([nothing.refreshed, nothing.calls.length], [false, 0]);
});

Deno.test("refresh, local model: no call when not even the next message fits beside the previous summary", async () => {
  const previous = {
    summary_text: "p".repeat(12_000), // a cloud model's memory, then a 4k local model
    covers_through: "2026-11-10T09:00:00.000Z",
    covered_message_count: 40,
    updated_at: "",
  };
  const { refreshed, calls } = await refresh(thread(10, 3_000), { profile: localMemoryProfile(4_096), previous });
  assertEquals([refreshed, calls.length], [false, 0]);
});
