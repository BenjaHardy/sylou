// analysis/sections.test.ts — output-shape pins for the FLOW prompt's
// data-section formatters (P4-1 Phase D split). These strings are what
// the scoring model reads as platform-framed evidence; the templates
// declare them trustworthy. A red test means the evidence framing
// changed — that needs a checkpoint, not a test edit.
// Run with: deno task test  (from supabase/functions/)
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildChatHistoryString,
  buildEditorStatsString,
  computeProvenanceStats,
} from "./sections.ts";

// --- computeProvenanceStats -------------------------------------------------

Deno.test("provenance stats: empty segment map falls back to 100% typed", () => {
  assertEquals(computeProvenanceStats("<p>hello</p>", []), {
    typed: 100, copy_chat: 0, copy_external: 0, ai: 0,
  });
});

Deno.test("provenance stats: gaps before segments count as typed; one-decimal percentages", () => {
  // 0-25 uncovered (typed by omission), 25-100 ai_editor → 25% / 75%.
  const stats = computeProvenanceStats("x", [
    { start: 25, end: 100, source: "ai_editor" },
  ]);
  assertEquals(stats.typed, 25);
  assertEquals(stats.ai, 75);
});

Deno.test("provenance stats: sources normalize through _provenance mapping", () => {
  const stats = computeProvenanceStats("x", [
    { start: 0, end: 10, source: "chat_ai" },
    { start: 10, end: 20, source: "external" },
    { start: 20, end: 30, source: "typed" },
  ]);
  assertEquals(stats.copy_chat, 33.3);
  assertEquals(stats.copy_external, 33.3);
  assertEquals(stats.typed, 33.3);
});

// --- buildChatHistoryString -------------------------------------------------

const baseMsg = {
  created_at: "2026-08-01T09:30:00.000Z",
  role: "user",
  content: "Hello there",
  source_type: null as string | null,
  flow_flag: null as string | null,
  thread_name: "Main",
};

// Timestamps render in the runtime's local zone; mirror the formatter's
// own Date arithmetic so the pin is zone-independent.
function expectedTs(iso: string): string {
  const dt = new Date(iso);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
}

Deno.test("chat history: base line shape [ts — Thread: name] role: content", () => {
  const out = buildChatHistoryString([{ ...baseMsg }], {});
  assertEquals(out, `[${expectedTs(baseMsg.created_at)} — Thread: Main] user: Hello there`);
});

Deno.test("chat history: source flag, doc names via map, web searches, [NOT ASSESSED] prefix", () => {
  const out = buildChatHistoryString(
    [{
      ...baseMsg,
      role: "assistant",
      source_type: "propose",
      flow_flag: "not_assessed",
      documents_referenced: ["doc-1", "doc-missing"],
      web_searches_performed: ["deno lint rules"],
    }],
    { "doc-1": "Paper.pdf" },
  );
  assert(out.startsWith("[NOT ASSESSED] ["));
  assert(out.includes("] assistant: Hello there [propose]"));
  assert(out.includes('[Documents referenced: "Paper.pdf", "doc-missing"]'));
  assert(out.includes('[Web searches performed: "deno lint rules"]'));
});

Deno.test("chat history: messages join with a blank line", () => {
  const out = buildChatHistoryString([{ ...baseMsg }, { ...baseMsg, content: "Second" }], {});
  assertEquals(out.split("\n\n").length, 2);
});

// --- buildEditorStatsString -------------------------------------------------

Deno.test("editor stats: empty ledger sentinel", () => {
  assertEquals(buildEditorStatsString([]), "No AI editor actions recorded.");
});

Deno.test("editor stats: counts, acceptance estimate, detailed log with source parsing", () => {
  const out = buildEditorStatsString([
    {
      action_type: "rewrite", outcome: "accepted",
      char_count_original: 100, char_count_result: 50,
      selected_text_preview: "orig text", ai_response_preview: "new text",
      instruction_text: "Make it formal | Source: user selection",
    },
    {
      action_type: "propose", outcome: "rejected",
      char_count_original: null, char_count_result: null,
      created_at: "2026-08-01T10:00:00.000Z",
    },
  ]);
  assert(out.includes("Total AI editor actions: 2"));
  assert(out.includes("By type: rewrite=1, propose=1"));
  assert(out.includes("By outcome: accepted=1, rejected=1"));
  assert(out.includes("Estimated % of writing from accepted AI suggestions: ~50%"));
  // Inline actions show full previews; the source suffix is parsed out of
  // instruction_text and the cleaned instruction shown separately.
  assert(out.includes('Original (source: user selection): "orig text"'));
  assert(out.includes('AI result: "new text"'));
  assert(out.includes('User instruction: "Make it formal"'));
  // Propose rows stay compact — content lives in the chat history.
  assert(out.includes("propose (rejected) at 2026-08-01T10:00:00.000Z — content in Chat History above"));
});

Deno.test("editor stats: full detail caps at 20; older actions get compact lines (no previews)", () => {
  const actions = Array.from({ length: 25 }, (_, i) => ({
    action_type: "grammar", outcome: "accepted",
    char_count_original: 10, char_count_result: 10,
    selected_text_preview: `sel-${i}`, ai_response_preview: `res-${i}`,
  }));
  const out = buildEditorStatsString(actions);
  assert(out.includes("--- Detailed action log (most recent 20) ---"));
  assert(out.includes("--- Action 20:"));
  assert(out.includes("--- Older actions (compact: type, outcome, size, selection source) ---"));
  assert(out.includes("--- Action 21: grammar (accepted), 10→10 chars ---"));
  assert(out.includes("--- Action 25: grammar (accepted), 10→10 chars ---"));
  // Older actions never leak their preview text — compact means compact.
  assert(!out.includes('"sel-20"'));
  assert(!out.includes('"res-24"'));
});

Deno.test("editor stats: compact tail carries the selection source label and en-US sizes", () => {
  const actions: Parameters<typeof buildEditorStatsString>[0] = Array.from(
    { length: 21 },
    (_, i) => ({
      action_type: "grammar", outcome: "accepted",
      char_count_original: 10, char_count_result: 10,
      selected_text_preview: `sel-${i}`, ai_response_preview: `res-${i}`,
    }),
  );
  actions[20] = {
    action_type: "grammar", outcome: "accepted",
    char_count_original: 1842, char_count_result: 1850,
    selected_text_preview: "large user-written passage…",
    ai_response_preview: "corrected passage…",
    instruction_text: "Fix grammar | Source: 100% [t]",
  };
  const out = buildEditorStatsString(actions);
  assert(out.includes(
    "--- Action 21: grammar (accepted), 1,842→1,850 chars, source: 100% [t] ---",
  ));
});

Deno.test("editor stats: propose rows beyond 20 keep their standard compact shape", () => {
  const actions: Parameters<typeof buildEditorStatsString>[0] = Array.from(
    { length: 21 },
    (_, i) => ({
      action_type: "grammar", outcome: "accepted",
      char_count_original: 10, char_count_result: 10,
      selected_text_preview: `sel-${i}`, ai_response_preview: `res-${i}`,
    }),
  );
  actions[20] = {
    action_type: "propose", outcome: "rejected",
    char_count_original: 500, char_count_result: null,
    created_at: "2026-08-01T10:00:00.000Z",
  };
  const out = buildEditorStatsString(actions);
  assert(out.includes(
    "--- Action 21: propose (rejected) at 2026-08-01T10:00:00.000Z — content in Chat History above ---",
  ));
});
