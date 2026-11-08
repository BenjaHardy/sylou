// The marks are placed by position in the new text, so a word diff that does
// not rebuild that text exactly must never be used: markChanges then falls
// back to the whitespace-exact diff. diffWords is mocked here to break.
import { describe, expect, it, vi } from "vitest";
import { markChanges } from "@/lib/replay-diff";

vi.mock("diff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("diff")>();
  return {
    ...actual,
    diffWords: () => [{ value: "not the new text", added: false, removed: false, count: 1 }],
  };
});

describe("markChanges: a word diff that does not rebuild the new text", () => {
  it("is replaced by the whitespace-exact diff", () => {
    const change = markChanges("<p>One two</p>", "<p>One two three</p>");
    expect(change.status).toBe("changed");
    const root = document.createElement("div");
    root.innerHTML = change.html;
    expect([...root.querySelectorAll("ins")].map((el) => el.textContent)).toEqual(["three"]);
  });
});
