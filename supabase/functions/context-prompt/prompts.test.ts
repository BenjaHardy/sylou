// Deno unit tests for the Ask/Propose prompt surface.
// Run with: deno test supabase/functions/context-prompt/prompts.test.ts
//
// The star here is the SENTINEL CROSS-PIN: buildSummaryPrompt's CRITICAL
// RULES and mergeSummary's branches are a matched string protocol living
// in one file — these tests go red if either side drifts without the
// other. A red test means the summary protocol changed; that needs a
// checkpoint, not a test edit.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildResponsePrompt,
  buildSummaryPrompt,
  CLASSIC_MODE_SYSTEM_PROMPT,
  CONCISE_MODE_MODIFIER,
  mergeSummary,
  TEMPLATE_PROMPTS,
  TUTOR_MODE_SYSTEM_PROMPT,
} from "./prompts.ts";

// ── mergeSummary: the three branches + the deliberate looseness ──────

Deno.test("mergeSummary: exact sentinel WITH an existing summary keeps it unchanged", () => {
  const r = mergeSummary("No update needed.", "EXISTING");
  assertEquals(r.updatedSummary, "EXISTING");
  assertEquals(r.summaryUpdate, "No update needed.");
});

Deno.test("mergeSummary: the sentinel WITHOUT an existing summary falls through to fresh-replace", () => {
  // Deliberate: an LLM replying "No update needed." on a first-ever call
  // has nothing to keep — the reply becomes the summary as-is.
  const r = mergeSummary("No update needed.", null);
  assertEquals(r.updatedSummary, "No update needed.");
  assertEquals(r.summaryUpdate, "No update needed.");
});

Deno.test('mergeSummary: "Additionally" appends to the existing summary with a newline', () => {
  const r = mergeSummary("Additionally, the villain has a name now.", "EXISTING");
  assertEquals(r.updatedSummary, "EXISTING\nAdditionally, the villain has a name now.");
  assertEquals(r.summaryUpdate, "Additionally, the villain has a name now.");
});

Deno.test("mergeSummary: comma-less 'Additionally' still appends (deliberately looser than the prompt)", () => {
  const r = mergeSummary("Additionally: new chapter outline.", "EXISTING");
  assertEquals(r.updatedSummary, "EXISTING\nAdditionally: new chapter outline.");
});

Deno.test("mergeSummary: fresh text replaces wholesale (delta === full on first summary)", () => {
  const r = mergeSummary("Writing currently includes an essay on X.", null);
  assertEquals(r.updatedSummary, "Writing currently includes an essay on X.");
  assertEquals(r.summaryUpdate, "Writing currently includes an essay on X.");
});

// ── the cross-pin: prompt instructions ↔ merge branches ─────────────

Deno.test("cross-pin: buildSummaryPrompt still mandates the exact literals mergeSummary matches on", () => {
  const [system] = buildSummaryPrompt("writing", "existing", "sel", "instr", "editor", "English");
  assert(system.content.includes('"No update needed."'), "sentinel instruction missing from prompt");
  assert(system.content.includes('"Additionally, "'), "Additionally instruction missing from prompt");
});

// ── buildSummaryPrompt shape ─────────────────────────────────────────

Deno.test("buildSummaryPrompt: interpolates inputs and renders None for a missing summary", () => {
  const [system, user] = buildSummaryPrompt("THE WRITING", null, "SEL", "INSTR", "editor", "French", "CREATIVE");
  assert(system.content.includes("Respond in French."));
  assert(system.content.includes("THE WRITING"));
  assert(system.content.includes("CREATIVE"));
  assert(system.content.includes("None"));
  assertEquals(user.role, "user");
  assert(user.content.includes('"INSTR"'));
});

// ── buildResponsePrompt ──────────────────────────────────────────────

Deno.test("buildResponsePrompt: ask vs propose task instructions differ as shipped", () => {
  const ask = buildResponsePrompt("SYS", "SUM", "SEL", "INSTR", "editor", [], "ask", "English");
  const propose = buildResponsePrompt("SYS", "SUM", "SEL", "INSTR", "editor", [], "propose", "English");
  assert(ask[0].content.includes("Respond to the user's question"));
  assert(propose[0].content.includes("Provide ONLY the proposed replacement text"));
  assertEquals(ask[1].content, "INSTR");
});

Deno.test("buildResponsePrompt: empty chat renders the fallback line; memory absent by default", () => {
  const [system] = buildResponsePrompt("SYS", "SUM", "SEL", "INSTR", "editor", [], "ask", "English");
  assert(system.content.includes("No previous messages."));
});

Deno.test("buildResponsePrompt: conversation memory injects beside RECENT CHAT HISTORY when present", () => {
  const withMem = buildResponsePrompt(
    "SYS", "SUM", "SEL", "INSTR", "editor",
    [{ role: "user", content: "hi" }],
    "ask", "English", "MEMORY-TEXT",
  );
  assert(withMem[0].content.includes("MEMORY-TEXT"));
  assert(withMem[0].content.includes("user: hi"));
});

// ── the hoisted constants exist and carry their key markers ─────────

Deno.test("mode/template prompts: hoisted constants keep their identifying content", () => {
  assert(CLASSIC_MODE_SYSTEM_PROMPT.includes("Sylou environment"));
  assert(TUTOR_MODE_SYSTEM_PROMPT.includes("Tutor Mode"));
  assert(TUTOR_MODE_SYSTEM_PROMPT.includes("F - Find"));
  assert(CONCISE_MODE_MODIFIER.includes("CONCISE MODE ACTIVE"));
  assertEquals(Object.keys(TEMPLATE_PROMPTS).sort(), ["academic", "creative", "professional"]);
});
