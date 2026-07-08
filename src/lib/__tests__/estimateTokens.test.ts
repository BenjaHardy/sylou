import { describe, it, expect } from "vitest";
import { estimateTokens, classifyTokenUsage } from "@/lib/estimateTokens";

describe("estimateTokens", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("uses the char-based estimate for dense text", () => {
    // 400 chars, 1 word: char est ceil(100 * 1.1) wins over word est 1.3.
    expect(estimateTokens("a".repeat(400))).toBe(111);
  });

  it("uses the word-based estimate for many short words", () => {
    // 100 one-char words (199 chars): word est 100 * 1.3 wins over char est ~55.
    expect(estimateTokens(Array(100).fill("a").join(" "))).toBe(130);
  });
});

describe("classifyTokenUsage", () => {
  it("reads the context limit from the model registry", () => {
    expect(classifyTokenUsage(1000, "mistral-medium-3-5").contextLimit).toBe(256_000);
    expect(classifyTokenUsage(1000, "claude-sonnet-4-6").contextLimit).toBe(1_000_000);
  });

  it("falls back to a conservative 200K for unknown model ids", () => {
    expect(classifyTokenUsage(1000, "some-stale-legacy-id").contextLimit).toBe(200_000);
  });

  it("classifies ok / near / over at the 0.8 and 1.0 boundaries", () => {
    // mistral-medium-3-5 → 256_000; 0.8 boundary = 204_800.
    expect(classifyTokenUsage(204_799, "mistral-medium-3-5").status).toBe("ok");
    expect(classifyTokenUsage(204_800, "mistral-medium-3-5").status).toBe("near");
    expect(classifyTokenUsage(255_999, "mistral-medium-3-5").status).toBe("near");
    expect(classifyTokenUsage(256_000, "mistral-medium-3-5").status).toBe("over");
  });

  it("the same estimate classifies differently per model", () => {
    // 300K tokens: over Mistral's 256K, comfortably ok for Claude's 1M —
    // the exact asymmetry the hardcoded model used to mask.
    expect(classifyTokenUsage(300_000, "mistral-medium-3-5").status).toBe("over");
    expect(classifyTokenUsage(300_000, "claude-sonnet-4-6").status).toBe("ok");
  });
});
