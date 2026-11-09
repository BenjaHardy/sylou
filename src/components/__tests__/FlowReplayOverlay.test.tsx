// The replay overlay shows stored writing HTML; it always goes through
// DOMPurify, whichever page renders the overlay. On a version step it marks
// what that version changed.
import { fireEvent, render, screen } from "@testing-library/react";
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

  const version = (minute: number, html: string): ReplayEvent => ({
    timestamp: `2026-10-13T10:${String(minute).padStart(2, "0")}:00.000Z`,
    type: "writing_version",
    content: { html },
  });
  const chat: ReplayEvent = {
    timestamp: "2026-10-13T10:05:00.000Z",
    type: "chat_message",
    content: { role: "user", content: "Can you help me expand this?", thread_name: "Main" },
  };
  const showStep = (container: HTMLElement, index: number) =>
    fireEvent.click(container.querySelector(`[data-index="${index}"]`) as HTMLElement);
  const marks = (container: HTMLElement) =>
    [...container.querySelectorAll("[data-replay-change]")].map(
      (el) => `${el.getAttribute("data-replay-change")}:${el.textContent}`,
    );

  it("marks what a version step changed and sums it up in words", () => {
    const events = [version(0, "<p>The cat sat.</p>"), chat, version(10, "<p>The black cat sat on the mat.</p>")];
    const { container } = render(<FlowReplayOverlay events={events} onClose={vi.fn()} />);
    showStep(container, 2);

    expect(marks(container)).toEqual(["added:black", "added:on the mat"]);
    expect(screen.getByText("+4 words / −0 words since the previous version.")).toBeInTheDocument();
    expect(screen.getByText(/^Changes since the version saved /)).toBeInTheDocument();
  });

  it("shows the latest version unmarked on a step that saved none", () => {
    const events = [version(0, "<p>The cat sat.</p>"), chat];
    const { container } = render(<FlowReplayOverlay events={events} onClose={vi.fn()} />);
    showStep(container, 1);

    expect(marks(container)).toEqual([]);
    expect(screen.getByText("The cat sat.")).toBeInTheDocument();
    expect(screen.getByText(/^No new version at this step/)).toBeInTheDocument();
  });

  it("opens a folded removal on click", () => {
    const long = Array.from({ length: 50 }, (_, i) => `word${i}`).join(" ");
    const events = [version(0, `<p>Kept. ${long}</p>`), version(10, "<p>Kept.</p>")];
    const { container } = render(<FlowReplayOverlay events={events} onClose={vi.fn()} />);
    showStep(container, 1);

    expect(screen.getByText("−50 words", { exact: false })).toBeInTheDocument();
    const rest = container.querySelector("[data-replay-rest]");
    expect(rest).toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("button", { name: "+30 more words" }));
    expect(rest).not.toHaveAttribute("hidden");
    expect(screen.queryByRole("button", { name: "+30 more words" })).toBeNull();
  });
});
