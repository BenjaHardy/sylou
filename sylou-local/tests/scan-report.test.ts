// Which scanner findings stop CI (D22): serious ones that have a fix.
//
// Run with: deno task test  (from sylou-local/)
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { line, type Match, serious } from "./scan-report.ts";

const finding = (severity: string, state: string): Match => ({
  vulnerability: { id: `CVE-2026-${severity}-${state}`, severity, fix: { state, versions: ["3.5.4-r1"] } },
  artifact: { name: "openssl", version: "3.5.3-r0", type: "apk" },
});

Deno.test("a HIGH or CRITICAL flaw with a fix counts; one without a fix, or a lesser one, does not", () => {
  const found = serious([
    finding("Critical", "fixed"),
    finding("High", "fixed"),
    finding("High", "not-fixed"),
    finding("High", "wont-fix"),
    finding("Medium", "fixed"),
    finding("Negligible", "fixed"),
  ]);
  assertEquals(found.map((match) => match.vulnerability.severity), ["Critical", "High"]);
});

Deno.test("each counted flaw says what to update, and to what", () => {
  const text = line(finding("High", "fixed"));
  assertStringIncludes(text, "openssl 3.5.3-r0");
  assertStringIncludes(text, "fixed in 3.5.4-r1");
});
