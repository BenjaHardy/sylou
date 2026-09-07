import { describe, it, expect } from "vitest";
import {
  assessSelectionSize,
  EDITOR_ACTION_OUTPUT_CHARS,
  EDITOR_ACTION_OUTPUT_TOKENS,
  LARGE_SELECTION_CHARS,
  SELECTED_TEXT_MAX_CHARS,
} from "@/lib/editor-limits";

describe("editor-limits (client mirror of the server budgets)", () => {
  it("mirrors the server constants (keep in sync with _shared/_models.ts)", () => {
    expect(SELECTED_TEXT_MAX_CHARS).toBe(50_000); // INPUT_LIMITS.SELECTED_TEXT_CHARS
    expect(EDITOR_ACTION_OUTPUT_TOKENS).toBe(1_000); // OUTPUT_BUDGETS.EDITOR_ACTION_TOKENS
    expect(EDITOR_ACTION_OUTPUT_CHARS).toBe(4_000);
  });

  it("warns below the output budget, never above the hard cap without saying so", () => {
    expect(LARGE_SELECTION_CHARS).toBeLessThan(EDITOR_ACTION_OUTPUT_CHARS);
    expect(assessSelectionSize(0)).toBe("ok");
    expect(assessSelectionSize(LARGE_SELECTION_CHARS)).toBe("ok");
    expect(assessSelectionSize(LARGE_SELECTION_CHARS + 1)).toBe("large");
    expect(assessSelectionSize(SELECTED_TEXT_MAX_CHARS)).toBe("large");
    expect(assessSelectionSize(SELECTED_TEXT_MAX_CHARS + 1)).toBe("too-long");
  });
});
