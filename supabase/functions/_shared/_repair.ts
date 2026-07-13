// ============================================================
// Canonical Claude tool_use repair helper.
//
// Single source of truth, imported via `../_shared/_repair.ts` by:
//   supabase/functions/analysis/index.ts
//
// (Not used by chat/, editor-action/, or context-prompt/ — those
// don't drive Claude tool_use responses through schema validation.)
//
// WORKAROUND: Claude's tool_use occasionally returns pillar
// fields as stringified JSON instead of nested objects. This
// layer normalizes the response before schema validation runs.
//
// If/when Anthropic stabilizes tool_use output, this layer
// should become inert (no repairs applied per run) and can
// eventually be removed. Grep the logs for "[FLOW repair]" to
// see whether it is still doing any work.
//
// This is NOT a permanent architectural decision — it is a
// targeted fix for an upstream model bug. Do not generalize.
// ============================================================

const PILLAR_KEYS = ["find", "lead", "organize", "write"] as const;
const REQUIRED_PILLAR_FIELDS = ["reasoning", "evidence", "score", "narrative"] as const;

function isPillarObject(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const obj = v as Record<string, unknown>;
  return REQUIRED_PILLAR_FIELDS.every((k) => k in obj);
}

/**
 * Normalize a tool_use input object so that any pillar field
 * delivered as a stringified JSON object becomes a parsed object.
 * Returns a new object — does not mutate the input — plus the list of
 * pillar keys that were repaired, so the caller can disclose the repair
 * in the stored report metadata (engineering-standards §5: a repaired
 * or defaulted section must be flagged, never silently substituted).
 * Pillars that cannot be repaired are passed through unchanged so
 * downstream schema validation (and the retry layer) can handle them.
 */
export function repairToolOutput(
  input: Record<string, unknown>,
): { output: Record<string, unknown>; repairedPillars: string[] } {
  const out: Record<string, unknown> = { ...input };
  const repairedPillars: string[] = [];
  for (const key of PILLAR_KEYS) {
    const value = out[key];
    if (isPillarObject(value)) continue;
    if (typeof value === "string" && value.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(value);
        if (isPillarObject(parsed)) {
          out[key] = parsed;
          repairedPillars.push(key);
          console.warn(
            "[FLOW repair UNEXPECTED] Structured Outputs returned non-conforming output for pillar",
            { pillar: key },
          );
        }
      } catch {
        // Leave the original value alone; validation + retry handle it.
      }
    }
  }
  return { output: out, repairedPillars };
}
