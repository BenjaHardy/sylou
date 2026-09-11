// FLOW-isolation tripwire: the conversation memory must NEVER become an
// analysis input (TRANSPARENCY.md §5.3/§5.5 — a continuity aid, not
// assessment evidence; the same principle as the withheld
// writing_summary_log). This test greps EVERY module in the analysis
// function's directory (the P4-1 split moved code into siblings, so
// scanning index.ts alone would leave holes) so the invariant is
// mechanical rather than convention: if a future change makes `analysis`
// read chat_thread_summaries — directly or by importing
// _conversation_memory — this fails and the change has to be argued in a
// PR that also edits this file.
// Run with: deno test --allow-read supabase/functions/_shared/_flow_isolation.test.ts
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("FLOW analysis never references the conversation memory", async () => {
  const dir = new URL("../analysis/", import.meta.url);
  let checked = 0;
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const src = await Deno.readTextFile(new URL(entry.name, dir));
    checked++;
    assert(
      !src.includes("chat_thread_summaries"),
      `analysis/${entry.name} must not read chat_thread_summaries (FLOW-isolation invariant)`,
    );
    assert(
      !src.includes("_conversation_memory"),
      `analysis/${entry.name} must not import _conversation_memory (FLOW-isolation invariant)`,
    );
  }
  assert(checked >= 6, `expected to scan the split analysis modules, found only ${checked} files`);
});
