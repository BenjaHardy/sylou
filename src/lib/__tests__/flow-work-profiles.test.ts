import { describe, it, expect } from "vitest";
import { getFlowProfile, getProfileCode } from "../flow-work-profiles";

describe("getFlowProfile", () => {
  it("returns The Architect for all pillars above threshold", () => {
    const p = getFlowProfile({ find: 4.0, lead: 3.5, organize: 3.0, write: 4.5 });
    expect(p.name).toBe("The Architect");
    expect(p.code).toBe("FLOW");
  });

  it("returns The Visionary for FL--", () => {
    const p = getFlowProfile({ find: 4.0, lead: 4.0, organize: 1.0, write: 1.0 });
    expect(p.name).toBe("The Visionary");
  });

  it("returns The Conductor for all pillars below threshold", () => {
    const p = getFlowProfile({ find: 1.0, lead: 1.0, organize: 1.0, write: 1.0 });
    expect(p.name).toBe("The Conductor");
  });

  it("returns The Voice when nulls present", () => {
    const p = getFlowProfile({ find: null, lead: 3.5, organize: null, write: 4.0 });
    expect(p.name).toBe("The Voice");
    expect(p.code).toBe("-L-W");
  });

  it("returns The Architect at exact boundary (3.0)", () => {
    const p = getFlowProfile({ find: 3.0, lead: 3.0, organize: 3.0, write: 3.0 });
    expect(p.name).toBe("The Architect");
  });

  it("returns The Conductor just below threshold (2.5)", () => {
    const p = getFlowProfile({ find: 2.5, lead: 2.5, organize: 2.5, write: 2.5 });
    expect(p.name).toBe("The Conductor");
  });
});

describe("getProfileCode", () => {
  it("builds correct code string", () => {
    expect(getProfileCode({ find: 3.0, lead: 1.0, organize: 4.0, write: null })).toBe("F-O-");
  });
});
