// Deno unit tests for the content-logging switch.
// Run with: deno test supabase/functions/_shared/_debug.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { contentLogsEnabled, parseContentLogsSetting } from "./_debug.ts";

Deno.test("content logs: only the exact value \"true\" turns them on", () => {
  assertEquals(parseContentLogsSetting("true"), true);
  for (const value of [undefined, "", "false", "TRUE", "True", "1", "yes", " true"]) {
    assertEquals(parseContentLogsSetting(value), false, `value ${JSON.stringify(value)}`);
  }
});

Deno.test("content logs: off when the environment cannot be read", () => {
  // `deno task test` grants no env access, so this exercises the fallback.
  assertEquals(contentLogsEnabled(), false);
});
