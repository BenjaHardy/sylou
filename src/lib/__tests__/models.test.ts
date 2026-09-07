// Registry sanity tests for the frontend model registry (P4-5) —
// the client-side mirror of the edge functions' _shared/_models checks.
import { describe, it, expect } from "vitest";
import { MODELS } from "@/lib/models";

describe("MODELS registry", () => {
  it("ids are unique and non-empty", () => {
    const ids = MODELS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id.trim()).not.toBe("");
  });

  it("every id matches its provider's routing prefix (mirrors _llm.ts routing)", () => {
    for (const m of MODELS) {
      if (m.id.startsWith("claude-")) expect(m.provider, m.id).toBe("anthropic");
      else if (m.id.startsWith("deepseek-")) expect(m.provider, m.id).toBe("deepseek");
      else expect(m.provider, m.id).toBe("mistral");
    }
  });

  it("pricing and context limits are sane", () => {
    for (const m of MODELS) {
      expect(m.pricing.input, m.id).toBeGreaterThan(0);
      expect(m.pricing.output, m.id).toBeGreaterThanOrEqual(m.pricing.input);
      expect(m.contextLimit, m.id).toBeGreaterThanOrEqual(128_000);
    }
  });

  it("no registry model uses a rolling alias (pinned-versions policy)", () => {
    for (const m of MODELS) expect(m.isRollingLatest, m.id).toBeFalsy();
  });

  it("exactly two models are recommended for FLOW: GLM 5.2 and Claude Sonnet 4.6 (maintainer rulings 2026-07 + 2026-09)", () => {
    const recommended = MODELS.filter((m) => m.note?.includes("Recommended for FLOW"));
    expect(recommended.map((m) => m.id)).toEqual(["zai-glm-5-2", "claude-sonnet-4-6"]);
  });

  it("no recommended model carries the experimental badge", () => {
    for (const m of MODELS) {
      if (m.note?.includes("Recommended for FLOW")) expect(m.isExperimental, m.id).toBeFalsy();
    }
  });
});
