// FLOW-isolation tripwire: the conversation memory must NEVER become an
// analysis input (TRANSPARENCY.md §5.4/§5.6 — a continuity aid, not
// assessment evidence; the same principle as the withheld
// writing_summary_log). This test greps the analysis function's source so
// the invariant is mechanical rather than convention: if a future change
// makes `analysis` read chat_thread_summaries — directly or by importing
// _conversation_memory — this fails and the change has to be argued in a
// PR that also edits this file.
// Run with: deno test --allow-read supabase/functions/_shared/_flow_isolation.test.ts
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("FLOW analysis never references the conversation memory", async () => {
  const src = await Deno.readTextFile(
    new URL("../analysis/index.ts", import.meta.url),
  );
  assert(
    !src.includes("chat_thread_summaries"),
    "analysis/index.ts must not read chat_thread_summaries (FLOW-isolation invariant)",
  );
  assert(
    !src.includes("_conversation_memory"),
    "analysis/index.ts must not import _conversation_memory (FLOW-isolation invariant)",
  );
});
