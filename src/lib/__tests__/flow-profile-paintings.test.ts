// Data-integrity tests for the style → painting mapping (P4-5).
//
// Every one of the 16 FLOW work styles must resolve to a complete
// painting entry (image asset, title, artist, year, source link,
// rationale) — a missing or orphaned mapping would only surface when a
// user lands on that profile and clicks the reveal.
import { describe, it, expect } from "vitest";
import { PROFILE_PAINTINGS } from "@/lib/flow-profile-paintings";
import { FLOW_PROFILES } from "@/lib/flow-work-profiles";

describe("PROFILE_PAINTINGS", () => {
  it("covers every one of the 16 style codes, with no orphans", () => {
    const profileCodes = FLOW_PROFILES.map((p) => p.code).sort();
    const paintingCodes = Object.keys(PROFILE_PAINTINGS).sort();
    expect(profileCodes).toHaveLength(16);
    expect(paintingCodes).toEqual(profileCodes);
  });

  it("every entry is complete (image, title, artist, year, source, rationale)", () => {
    for (const [code, p] of Object.entries(PROFILE_PAINTINGS)) {
      expect(p.image, `${code}: image`).toBeTruthy();
      expect(typeof p.image, `${code}: image path`).toBe("string");
      expect(p.title.trim(), `${code}: title`).not.toBe("");
      expect(p.artist.trim(), `${code}: artist`).not.toBe("");
      expect(p.year.trim(), `${code}: year`).not.toBe("");
      expect(p.sourceUrl, `${code}: sourceUrl`).toMatch(/^https:\/\//);
      expect(p.rationale.trim(), `${code}: rationale`).not.toBe("");
    }
  });
});
