// Hook-level pins for useSmoothedText: mount-snap, smoothed growth,
// reset-snap, and interval cleanup on unmount.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SMOOTH_TICK_MS } from "@/lib/stream-smoothing";
import { useSmoothedText } from "../useSmoothedText";

describe("useSmoothedText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("snaps to the full current text on mount (thread switch-back contract)", () => {
    const { result } = renderHook(() => useSmoothedText("already streamed partial"));
    expect(result.current).toBe("already streamed partial");
  });

  it("reveals growth gradually, reaching the full text within a bounded time", () => {
    const { result, rerender } = renderHook(({ text }) => useSmoothedText(text), {
      initialProps: { text: "Hi" },
    });
    expect(result.current).toBe("Hi");

    const grown = "Hi" + " there, this is a multi-word Claude-style clump of text.";
    rerender({ text: grown });
    // Immediately after arrival, only the previously revealed prefix shows.
    expect(result.current).toBe("Hi");

    act(() => {
      vi.advanceTimersByTime(SMOOTH_TICK_MS);
    });
    expect(result.current.length).toBeGreaterThan(2);
    expect(result.current.length).toBeLessThan(grown.length);
    expect(grown.startsWith(result.current)).toBe(true);

    act(() => {
      vi.advanceTimersByTime(SMOOTH_TICK_MS * 100);
    });
    expect(result.current).toBe(grown);
  });

  it("snaps on a stream reset (new text that is not an extension)", () => {
    const { result, rerender } = renderHook(({ text }) => useSmoothedText(text), {
      initialProps: { text: "first answer already long" },
    });
    rerender({ text: "brand new second answer" });
    expect(result.current).toBe("brand new second answer");
  });

  it("clears its interval on unmount", () => {
    const { unmount } = renderHook(() => useSmoothedText("x"));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
