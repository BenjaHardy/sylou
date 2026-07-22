// Tests for the FLOW band mapping (P4-5).
//
// The UI never shows raw scores — only band labels — so this mapping is
// product-load-bearing: a wrong band silently mislabels an assessment.
// The band ranges deliberately have gaps (0.5→1.0, 1.5→2.0, …) covered by
// defensive fallbacks; both the ranges and the fallbacks are pinned here.
import { describe, it, expect } from "vitest";
import {
  FLOW_BANDS,
  FLOW_ZONE_BOUNDARIES,
  getBandForScore,
  getBandLabel,
} from "@/lib/flowBands";

describe("FLOW_BANDS table", () => {
  it("has exactly six bands, ordered AI-led → Human-authored", () => {
    expect(FLOW_BANDS.map((b) => b.label)).toEqual([
      "AI-led",
      "AI-led, human-refined",
      "Collaborative",
      "Human-led, AI-assisted",
      "Human-led",
      "Human-authored",
    ]);
  });

  it("keeps ranges ascending, non-overlapping, with midpoints inside", () => {
    for (let i = 0; i < FLOW_BANDS.length; i++) {
      const b = FLOW_BANDS[i];
      expect(b.minScore).toBeLessThanOrEqual(b.maxScore);
      expect(b.midpoint).toBeGreaterThanOrEqual(b.minScore);
      expect(b.midpoint).toBeLessThanOrEqual(b.maxScore);
      if (i > 0) expect(b.minScore).toBeGreaterThan(FLOW_BANDS[i - 1].maxScore);
    }
  });

  it("zone boundaries are seven ascending values spanning 0..5", () => {
    expect(FLOW_ZONE_BOUNDARIES).toHaveLength(7);
    expect(FLOW_ZONE_BOUNDARIES[0]).toBe(0);
    expect(FLOW_ZONE_BOUNDARIES[6]).toBe(5.0);
    for (let i = 1; i < FLOW_ZONE_BOUNDARIES.length; i++) {
      expect(FLOW_ZONE_BOUNDARIES[i]).toBeGreaterThan(FLOW_ZONE_BOUNDARIES[i - 1]);
    }
  });
});

describe("getBandForScore", () => {
  it("maps every calibration anchor to its band", () => {
    expect(getBandForScore(0.0)?.label).toBe("AI-led");
    expect(getBandForScore(1.0)?.label).toBe("AI-led, human-refined");
    expect(getBandForScore(2.0)?.label).toBe("Collaborative");
    expect(getBandForScore(3.0)?.label).toBe("Human-led, AI-assisted");
    expect(getBandForScore(4.0)?.label).toBe("Human-led");
    expect(getBandForScore(5.0)?.label).toBe("Human-authored");
  });

  it("includes both half-point bounds of each range", () => {
    expect(getBandForScore(0.5)?.label).toBe("AI-led");
    expect(getBandForScore(3.5)?.label).toBe("Human-led, AI-assisted");
    expect(getBandForScore(4.5)?.label).toBe("Human-led");
  });

  it("covers the inter-band gaps via the defensive fallbacks (round down)", () => {
    expect(getBandForScore(0.75)?.label).toBe("AI-led");
    expect(getBandForScore(1.75)?.label).toBe("AI-led, human-refined");
    expect(getBandForScore(2.75)?.label).toBe("Collaborative");
    expect(getBandForScore(3.75)?.label).toBe("Human-led, AI-assisted");
    expect(getBandForScore(4.75)?.label).toBe("Human-led");
  });

  it("returns null for null, undefined, NaN and out-of-range scores", () => {
    expect(getBandForScore(null)).toBeNull();
    expect(getBandForScore(undefined)).toBeNull();
    expect(getBandForScore(Number.NaN)).toBeNull();
    expect(getBandForScore(-0.5)).toBeNull();
    expect(getBandForScore(5.5)).toBeNull();
  });
});

describe("getBandLabel", () => {
  it("labels scores and falls back to Insufficient evidence", () => {
    expect(getBandLabel(3.0)).toBe("Human-led, AI-assisted");
    expect(getBandLabel(null)).toBe("Insufficient evidence");
    expect(getBandLabel(undefined)).toBe("Insufficient evidence");
    expect(getBandLabel(Number.NaN)).toBe("Insufficient evidence");
    expect(getBandLabel(9)).toBe("Insufficient evidence");
  });
});
