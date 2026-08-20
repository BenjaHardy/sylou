// Pins for the stream-reveal math (see stream-smoothing.ts header for the
// provider-granularity diagnosis this exists for). A red test means the
// reveal contract changed — check the hook's consumers before editing.
import { describe, expect, it } from "vitest";
import {
  FOLLOW_BOTTOM_THRESHOLD_PX,
  isNearBottom,
  isStreamReset,
  nextRevealLength,
  SMOOTH_CATCH_UP,
  SMOOTH_MIN_STEP,
  SMOOTH_SNAP_CAP,
} from "../stream-smoothing";

describe("nextRevealLength", () => {
  it("small backlogs advance by the minimum step (smooth providers stay instant-feeling)", () => {
    const target = "abcdef";
    expect(nextRevealLength(3, target)).toBe(3 + SMOOTH_MIN_STEP);
  });

  it("large backlogs drain proportionally (~10% per tick)", () => {
    const target = "x".repeat(1000);
    expect(nextRevealLength(0, target)).toBe(Math.ceil(1000 * SMOOTH_CATCH_UP));
  });

  it("drains geometrically to completion, never regressing", () => {
    const target = "y".repeat(400);
    let revealed = 0;
    let ticks = 0;
    while (revealed < target.length && ticks < 200) {
      const next = nextRevealLength(revealed, target);
      expect(next).toBeGreaterThan(revealed);
      revealed = next;
      ticks++;
    }
    expect(revealed).toBe(target.length);
    expect(ticks).toBeLessThan(60); // ~2s at 30Hz for a 400-char clump
  });

  it("clamps at the target and no-ops once complete", () => {
    expect(nextRevealLength(5, "abcde")).toBe(5);
    expect(nextRevealLength(99, "abc")).toBe(3);
  });

  it("a backlog past the snap cap reveals everything at once", () => {
    const target = "z".repeat(SMOOTH_SNAP_CAP + 10);
    expect(nextRevealLength(0, target)).toBe(target.length);
  });

  it("never ends the reveal between a surrogate pair (emoji stay whole)", () => {
    // "ab" + 😀 (surrogate pair) + padding; step from 1 with backlog 5
    // would land at index 3 — inside the pair — so it must advance past it.
    const target = "ab\u{1F600}cd";
    const next = nextRevealLength(1, target);
    const boundary = target.charCodeAt(next - 1);
    expect(boundary >= 0xd800 && boundary <= 0xdbff).toBe(false);
  });

  it("holds back a lone high surrogate at the target's end until its pair arrives", () => {
    const split = "ab" + "\u{1F600}"[0]; // provider delta split the emoji
    const next = nextRevealLength(2, split);
    expect(next).toBe(2); // waits
    const completed = "ab\u{1F600}";
    expect(nextRevealLength(2, completed)).toBe(4);
  });
});

describe("isNearBottom", () => {
  it("exactly at the bottom counts as near", () => {
    expect(isNearBottom(1000, 1600, 600)).toBe(true);
  });

  it("within the threshold still counts as near (fractional wobble tolerated)", () => {
    expect(isNearBottom(1000 - FOLLOW_BOTTOM_THRESHOLD_PX, 1600, 600)).toBe(true);
  });

  it("scrolled up past the threshold is not near — the view holds", () => {
    expect(isNearBottom(1000 - FOLLOW_BOTTOM_THRESHOLD_PX - 1, 1600, 600)).toBe(false);
    expect(isNearBottom(0, 1600, 600)).toBe(false);
  });
});

describe("isStreamReset", () => {
  it("growth is not a reset", () => {
    expect(isStreamReset("Hello", "Hello wor")).toBe(false);
  });

  it("identical text is not a reset", () => {
    expect(isStreamReset("same", "same")).toBe(false);
  });

  it("a shrinking target is a reset", () => {
    expect(isStreamReset("long answer", "lo")).toBe(true);
  });

  it("a non-extension of equal-or-greater length is a reset", () => {
    expect(isStreamReset("first answer", "second reply!")).toBe(true);
  });
});
