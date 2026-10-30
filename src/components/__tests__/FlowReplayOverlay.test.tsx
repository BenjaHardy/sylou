// The replay overlay shows stored writing HTML; it always goes through
// DOMPurify, whichever page renders the overlay.
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FlowReplayOverlay, type ReplayEvent } from "@/components/FlowReplayOverlay";

beforeAll(() => {
  // jsdom implements neither layout observers nor programmatic scrolling.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});

describe("FlowReplayOverlay", () => {
  it("sanitizes the writing snapshot it shows", () => {
    const events: ReplayEvent[] = [
      {
        timestamp: "2026-10-13T10:00:00.000Z",
        type: "writing_version",
        content: { html: '<p>Draft <strong>one</strong></p><img src="x" onerror="alert(1)"><script>alert(2)</script>' },
      },
    ];
    const { container } = render(<FlowReplayOverlay events={events} onClose={vi.fn()} />);

    expect(screen.getByText("one").tagName).toBe("STRONG");
    expect(container.querySelector("[onerror]")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
