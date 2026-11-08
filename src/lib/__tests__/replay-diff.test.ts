import { describe, expect, it } from "vitest";
import { countWords, markChanges, writingStepAt, type ReplayVersionEvent } from "@/lib/replay-diff";

/** The marked HTML, parsed for inspection. */
function render(previous: string | null, current: string, limits?: Parameters<typeof markChanges>[2]) {
  const change = markChanges(previous, current, limits);
  const root = document.createElement("div");
  root.innerHTML = change.html;
  const texts = (selector: string) => [...root.querySelectorAll(selector)].map((el) => el.textContent);
  return { change, root, added: texts("ins"), removed: texts("del") };
}

describe("markChanges: what a version changed", () => {
  it("underlines added words and nothing else", () => {
    const { change, added, removed } = render("<p>The cat sat on the mat.</p>", "<p>The black cat sat on the mat.</p>");
    expect(change.status).toBe("changed");
    expect(added).toEqual(["black"]);
    expect(removed).toEqual([]);
    expect([change.wordsAdded, change.wordsRemoved]).toEqual([1, 0]);
  });

  it("shows removed words struck through, in brackets, where they were", () => {
    const { change, root, removed } = render("<p>The cat sat on the old mat.</p>", "<p>The cat sat on the mat.</p>");
    expect(removed).toEqual(["old"]);
    expect(root.querySelector('[data-replay-change="removed"]')?.textContent).toBe("[old]");
    expect(root.textContent?.replace(/\s+/g, "")).toBe("Thecatsatonthe[old]mat.");
    expect([change.wordsAdded, change.wordsRemoved]).toEqual([0, 1]);
  });

  it("puts a replaced word's removal before its replacement", () => {
    const { root, change } = render("<p>The cat sat.</p>", "<p>The cat jumped.</p>");
    const marks = [...root.querySelectorAll("[data-replay-change]")].map((el) => `${el.getAttribute("data-replay-change")}:${el.textContent}`);
    expect(marks).toEqual(["removed:[sat]", "added:jumped"]);
    expect([change.wordsAdded, change.wordsRemoved]).toEqual([1, 1]);
  });

  it("shows a rewritten sentence as one replacement, not words matched by chance", () => {
    const { added, removed } = render(
      "<p>Kept.</p><p>From the top he could see the harbour and, far away, a name on a stone.</p>",
      "<p>Kept.</p><p>He never missed a night.</p>",
    );
    expect(removed).toEqual(["From the top he could see the harbour and, far away, a name on a stone"]);
    expect(added).toEqual(["He never missed a night"]);
  });

  it("keeps a real match between two edits", () => {
    const { added, removed } = render("<p>The cat sat on the mat.</p>", "<p>The dog sat on the rug.</p>");
    expect(removed).toEqual(["cat", "mat"]);
    expect(added).toEqual(["dog", "rug"]);
  });

  it("keeps a word between two small edits unchanged", () => {
    const { added, removed } = render(
      "<p>The keeper climbed the stairs every evening.</p>",
      "<p>Every evening, the old keeper climbed the <strong>hundred</strong> stairs.</p>",
    );
    expect(removed).toEqual(["The", "every evening"]);
    expect(added).toEqual(["Every evening, the old", "hundred"]);
  });

  it("never merges edits across paragraphs", () => {
    const { root } = render(
      "<p>Alpha one two three four five six seven.</p><p>Beta eight nine ten eleven twelve.</p>",
      "<p>Alpha red green blue yellow purple.</p><p>Beta cyan magenta black white.</p>",
    );
    const paragraphs = [...root.querySelectorAll("p")];
    expect(paragraphs.map((p) => p.querySelectorAll('[data-replay-change="removed"]').length)).toEqual([1, 1]);
  });

  it("keeps the version's formatting, marking inside it", () => {
    const { root, added } = render("<p>A <strong>red</strong> car</p>", '<p>A <strong>bright red</strong> <span style="color: rgb(0, 0, 255)">car</span></p>');
    expect(added).toEqual(["bright"]);
    expect(root.querySelector("ins")?.closest("strong")).not.toBeNull();
    expect(root.querySelector("span[style]")?.textContent).toBe("car");
  });

  it("marks a new paragraph and a removed one without adding blocks", () => {
    const { root, added, removed } = render(
      "<p>One.</p><p>Two.</p><p>Three.</p>",
      "<p>One.</p><p>Three.</p><p>Four.</p>",
    );
    expect(added).toEqual(["Four."]);
    expect(removed).toEqual(["Two."]);
    expect(root.querySelectorAll("p")).toHaveLength(3);
    expect(root.querySelector("ins")?.closest("p")?.textContent).toBe("Four.");
  });

  it("splits an addition that spans two paragraphs, one mark per paragraph", () => {
    const { root, added } = render("<p>Start.</p>", "<p>Start. More here.</p><p>And a new paragraph.</p>");
    expect(added).toEqual(["More here.", "And a new paragraph."]);
    for (const ins of root.querySelectorAll("ins")) expect(ins.parentElement?.tagName).toBe("P");
  });

  it("places a removal at the very end after the last words", () => {
    const { root, removed } = render("<p>Keep this. Drop this.</p>", "<p>Keep this.</p>");
    expect(removed).toEqual(["Drop this."]);
    expect(root.querySelector("p")?.textContent).toBe("Keep this.[Drop this.]");
  });

  it("still shows the removals when everything was removed", () => {
    const { change, removed } = render("<p>Gone.</p>", "<p></p>");
    expect(change.status).toBe("changed");
    expect(removed).toEqual(["Gone."]);
  });

  it("folds a long removal behind a button showing how many words are hidden", () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(" ");
    const { root } = render(`<p>Kept. ${long}</p>`, "<p>Kept.</p>");
    const rest = root.querySelector("[data-replay-rest]");
    expect(rest?.hasAttribute("hidden")).toBe(true);
    expect(root.querySelector("[data-replay-expand]")?.textContent).toBe("+40 more words");
    const del = root.querySelector("del");
    expect(countWords(del?.firstChild?.textContent ?? "")).toBe(20);
    expect(countWords(rest?.textContent ?? "")).toBe(40);
  });

  it("shows removed text as text, never as markup", () => {
    const { root, removed } = render("<p>Safe &lt;img src=x onerror=alert(1)&gt; text</p>", "<p>Safe text</p>");
    expect(root.querySelector("img")).toBeNull();
    expect(removed.join("")).toContain("<img src=x onerror=alert(1)>");
  });

  it("sanitizes the marked version", () => {
    const { root, added } = render(
      "<p>Draft</p>",
      '<p>Draft one</p><img src="x" onerror="alert(1)"><script>alert(2)</script>',
    );
    expect(added).toEqual(["one"]);
    expect(root.querySelector("[onerror]")).toBeNull();
    expect(root.querySelector("script")).toBeNull();
  });
});

describe("markChanges: steps with nothing to mark", () => {
  it("first version: nothing marked, every word counted as added", () => {
    const { change, root } = render(null, "<p>Three little words</p>");
    expect(change.status).toBe("first");
    expect(change.wordsAdded).toBe(3);
    expect(root.querySelector("[data-replay-change]")).toBeNull();
  });

  it("tells a formatting-only change from no change at all", () => {
    expect(render("<p>Plain words</p>", "<p><strong>Plain</strong> words</p>").change.status).toBe("formatting");
    expect(render("<p>Plain words</p>", "<p>Plain words</p>").change.status).toBe("identical");
  });

  it("gives up on a rewrite too large to compare and shows the version unmarked", () => {
    const { change, root } = render("<p>One two three</p>", "<p>Four five six seven</p>", { maxEditLength: 1 });
    expect(change.status).toBe("too-many");
    expect(root.querySelector("[data-replay-change]")).toBeNull();
    expect([change.wordsBefore, change.wordsAfter]).toEqual([3, 4]);
  });
});

describe("countWords", () => {
  it("counts words, not spaces or punctuation", () => {
    expect(countWords("Hello, world!  —  42 l'homme\nżółw ")).toBe(5);
    expect(countWords(" … ")).toBe(0);
  });
});

describe("writingStepAt: which writing a replay step shows", () => {
  const version = (minute: number, html: string): ReplayVersionEvent => ({
    type: "writing_version",
    timestamp: `2026-11-08T10:${String(minute).padStart(2, "0")}:00.000Z`,
    content: { html },
  });
  const chat: ReplayVersionEvent = { type: "chat_message", timestamp: "2026-11-08T10:05:00.000Z", content: {} };

  it("shows nothing before the first version", () => {
    expect(writingStepAt([chat, version(10, "<p>Hello</p>")], 0)).toEqual({ kind: "none" });
  });

  it("carries the latest version, unmarked, through other events", () => {
    const step = writingStepAt([version(0, "<p>Hello</p>"), chat], 1);
    expect(step.kind).toBe("carried");
    if (step.kind === "carried") {
      expect(step.savedAt).toBe("2026-11-08T10:00:00.000Z");
      expect(step.html).not.toContain("data-replay-change");
    }
  });

  it("compares a version with the previous one, skipping empty versions", () => {
    const events = [version(0, "<p>Hello</p>"), chat, version(6, ""), version(7, "<p>Hello world</p>")];
    const step = writingStepAt(events, 3);
    expect(step.kind).toBe("version");
    if (step.kind === "version") {
      expect(step.previousSavedAt).toBe("2026-11-08T10:00:00.000Z");
      expect(step.change.status).toBe("changed");
      expect(step.change.wordsAdded).toBe(1);
    }
  });
});
