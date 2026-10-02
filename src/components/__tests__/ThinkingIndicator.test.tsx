// The "Thinking…" indicator counts whole seconds from the moment it mounts
// and stops its clock on unmount (it only lives while a stream is in its
// reasoning phase).
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThinkingIndicator } from "@/components/ThinkingIndicator";

describe("ThinkingIndicator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows Thinking… without a count at first, then the elapsed whole seconds", () => {
    render(<ThinkingIndicator />);
    expect(screen.getByRole("status")).toHaveTextContent(/^Thinking…$/);

    act(() => {
      vi.advanceTimersByTime(3_100);
    });
    expect(screen.getByRole("status")).toHaveTextContent(/^Thinking… 3s$/);
  });

  it("stops its clock on unmount", () => {
    const { unmount } = render(<ThinkingIndicator />);
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
