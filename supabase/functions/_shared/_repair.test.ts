// Deno unit tests for repairToolOutput.
// Run with: deno test supabase/functions/_shared/_repair.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { repairToolOutput } from "./_repair.ts";

const PILLAR = { reasoning: "r", evidence: [], score: 3.5, narrative: "n" };

Deno.test("clean input: output unchanged, no repairs reported", () => {
  const input = { summary: "s", find: PILLAR, lead: PILLAR, organize: PILLAR, write: PILLAR };
  const { output, repairedPillars } = repairToolOutput(input);
  assertEquals(output, input);
  assertEquals(repairedPillars, []);
});

Deno.test("stringified pillar is parsed and reported", () => {
  const input = { find: JSON.stringify(PILLAR), lead: PILLAR, organize: PILLAR, write: PILLAR };
  const { output, repairedPillars } = repairToolOutput(input);
  assertEquals(output.find, PILLAR);
  assertEquals(repairedPillars, ["find"]);
});

Deno.test("multiple stringified pillars are all reported, in pillar order", () => {
  const input = {
    find: JSON.stringify(PILLAR),
    lead: PILLAR,
    organize: JSON.stringify(PILLAR),
    write: JSON.stringify(PILLAR),
  };
  const { repairedPillars } = repairToolOutput(input);
  assertEquals(repairedPillars, ["find", "organize", "write"]);
});

Deno.test("unparseable string passes through and is not reported", () => {
  const input = { find: "{not json", lead: PILLAR, organize: PILLAR, write: PILLAR };
  const { output, repairedPillars } = repairToolOutput(input);
  assertEquals(output.find, "{not json");
  assertEquals(repairedPillars, []);
});

Deno.test("parsed JSON that is not pillar-shaped is left alone and not reported", () => {
  const notAPillar = JSON.stringify({ nope: true });
  const input = { find: notAPillar, lead: PILLAR, organize: PILLAR, write: PILLAR };
  const { output, repairedPillars } = repairToolOutput(input);
  assertEquals(output.find, notAPillar);
  assertEquals(repairedPillars, []);
});

Deno.test("input object is not mutated by a repair", () => {
  const stringified = JSON.stringify(PILLAR);
  const input: Record<string, unknown> = { find: stringified, lead: PILLAR, organize: PILLAR, write: PILLAR };
  repairToolOutput(input);
  assertEquals(input.find, stringified);
});
