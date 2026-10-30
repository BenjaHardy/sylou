// The conversation-memory dialog renders the model-written summary as
// markdown: formatting comes through, an image is a link to open, never an
// <img> the browser loads.
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationMemoryDialog } from "@/components/ConversationMemoryView";

describe("ConversationMemoryDialog", () => {
  it("renders the summary as markdown and shows an image in it as a link", () => {
    render(
      <ConversationMemoryDialog
        open
        onOpenChange={vi.fn()}
        memory={{
          summary_text: "Earlier **notes**. ![outline](https://example.com/outline.png?q=draft)",
          covers_through: "2026-10-13T10:05:00.000Z",
          covered_message_count: 2,
          model_used: null,
          updated_at: "2026-10-13T10:06:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("notes").tagName).toBe("STRONG");
    expect(document.body.querySelector("img")).toBeNull();
    const outline = screen.getByRole("link", { name: "outline" });
    expect(outline).toHaveAttribute("href", "https://example.com/outline.png?q=draft");
    expect(outline).toHaveAttribute("rel", "noopener noreferrer");
  });
});
