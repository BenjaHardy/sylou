// Consistency pins for the provenance-annotated writing shown on a FLOW
// report. A report freezes two columns in one insert: the writing HTML and
// the provenance map (TipTap positions). FlowHighlightedText re-derives the
// positions from the HTML, so any drift between its arithmetic and
// ProseMirror's would paint the wrong characters.
//
// Each case builds the pair with a REAL headless TipTap editor and the real
// ProvenanceTracker, the way the app produces it, then checks that the
// rendering (1) reproduces the document's text exactly and (2) highlights,
// per source, exactly the characters the editor says the segments cover.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { sylouStarterKit } from "@/lib/editor-extensions/sylou-starter";
import { ProvenanceTracker, type SegmentSource } from "@/lib/provenance-tracker";
import { FlowHighlightedText } from "@/components/FlowHighlightedText";

/** The background class FlowHighlightedText paints each source with. */
const CLASS_OF: Record<SegmentSource, string> = {
  typed: "bg-green-200/60",
  chat_user: "bg-green-200/60",
  chat_ai: "bg-red-200/60",
  ai_editor: "bg-blue-200/60",
  external: "bg-gray-200/60",
};

/** ProseMirror position of the first occurrence of `needle` in a text node. */
function posOfText(doc: PMNode, needle: string): number {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text) {
      const i = node.text.indexOf(needle);
      if (i >= 0) found = pos + i;
    }
    return found < 0;
  });
  if (found < 0) throw new Error(`"${needle}" not found in the document`);
  return found;
}

interface Insertion {
  /** Insert right before this text (first occurrence) … */
  before?: string;
  /** … or right after this text. */
  after?: string;
  text: string;
  source: SegmentSource;
}

/** Builds (writing_snapshot, provenance_snapshot) exactly as the app does:
 *  a typed document, then insertions carrying a pending provenance signal,
 *  fed to the tracker through the editor's own transactions. */
function buildSnapshot(initialHtml: string, insertions: Insertion[]) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: sylouStarterKit(),
    content: initialHtml,
  });
  const tracker = new ProvenanceTracker();
  const size = () => editor.state.doc.content.size;
  tracker.init([{ start: 0, end: size(), source: "typed" }], size());

  const captured: Transaction[] = [];
  editor.on("transaction", ({ transaction }) => {
    if (transaction.docChanged) captured.push(transaction);
  });

  for (const ins of insertions) {
    const doc = editor.state.doc;
    const pos = ins.before !== undefined ? posOfText(doc, ins.before) : posOfText(doc, ins.after!) + ins.after!.length;
    tracker.setPendingSignal({
      kind: "slice",
      segments: [{ offset: 0, length: ins.text.length, source: ins.source }],
      totalLength: ins.text.length,
    });
    editor.view.dispatch(editor.state.tr.insertText(ins.text, pos));
    for (const tr of captured) tracker.applyTransaction({ mapping: tr.mapping, doc: tr.doc as never }, true);
    captured.length = 0;
  }

  const doc = editor.state.doc;
  const segments = tracker.getSegments();
  const result = {
    html: editor.getHTML(),
    segments,
    /** The whole text, blocks concatenated, as the editor sees it. */
    text: doc.textBetween(0, doc.content.size, ""),
    /** The characters the editor says a source covers. */
    textOf: (source: SegmentSource) =>
      segments.filter((s) => s.source === source).map((s) => doc.textBetween(s.start, s.end, "")).join(""),
    size: doc.content.size,
  };
  editor.destroy();
  return result;
}

function renderPair(pair: ReturnType<typeof buildSnapshot>) {
  const { container } = render(
    <FlowHighlightedText segments={pair.segments} writingContent={pair.html} onClose={() => {}} />,
  );
  const annotated = container.querySelector(".font-mono") as HTMLElement;
  const highlighted = (source: SegmentSource) =>
    Array.from(annotated.querySelectorAll("span"))
      .filter((s) => s.className.includes(CLASS_OF[source]))
      .map((s) => s.textContent)
      .join("");
  return { container, annotated, highlighted };
}

/** The three checks every case must pass. */
function expectConsistent(pair: ReturnType<typeof buildSnapshot>, sources: SegmentSource[]) {
  const { annotated, highlighted } = renderPair(pair);
  // 1. Nothing dropped, duplicated or reordered.
  expect(annotated.textContent).toBe(pair.text);
  // 2. Each source paints exactly the characters the editor assigns to it.
  for (const source of sources) {
    expect(highlighted(source), source).toBe(pair.textOf(source));
  }
  // 3. The map covers the whole frozen document, so the pair is complete.
  const covered = pair.segments.reduce((n, s) => n + (s.end - s.start), 0);
  expect(covered).toBe(pair.size);
}

describe("FlowHighlightedText: the frozen writing and its provenance map agree", () => {
  it("an AI insertion in the middle of a paragraph", () => {
    const pair = buildSnapshot("<p>Hello world</p>", [{ after: "Hello", text: " brave new", source: "ai_editor" }]);
    expect(pair.text).toBe("Hello brave new world");
    expect(pair.textOf("ai_editor")).toBe(" brave new");
    expectConsistent(pair, ["ai_editor", "typed"]);
  });

  it("several blocks and several sources: chat paste in one paragraph, external paste in another", () => {
    const pair = buildSnapshot("<h1>Title</h1><p>First para.</p><p>Second para.</p>", [
      { before: "para.", text: "chat-pasted ", source: "chat_ai" },
      { after: "Second", text: " externally pasted", source: "external" },
    ]);
    expect(pair.text).toBe("TitleFirst chat-pasted para.Second externally pasted para.");
    expectConsistent(pair, ["chat_ai", "external", "typed"]);
  });

  it("an entity and inline marks before the insertion do not shift the highlight", () => {
    const pair = buildSnapshot("<p>Fish &amp; <strong>chips</strong> are here</p>", [
      { before: "are", text: "crispy ", source: "ai_editor" },
    ]);
    expect(pair.html).toContain("&amp;");
    expect(pair.textOf("ai_editor")).toBe("crispy ");
    expectConsistent(pair, ["ai_editor", "typed"]);
  });

  it("nested list structure: every block level costs positions on both sides", () => {
    const pair = buildSnapshot("<ul><li><p>one</p></li><li><p>two</p></li></ul>", [
      { after: "two", text: " plus more", source: "ai_editor" },
    ]);
    expect(pair.text).toBe("onetwo plus more");
    expectConsistent(pair, ["ai_editor", "typed"]);
  });

  it("a hard break is one position on both sides", () => {
    const pair = buildSnapshot("<p>line<br>break</p>", [{ after: "break", text: " after", source: "chat_ai" }]);
    expect(pair.html).toContain("<br");
    expectConsistent(pair, ["chat_ai", "typed"]);
  });

  it("the stats line reports each source's share of the map", () => {
    const pair = buildSnapshot("<p>Hello world</p>", [{ after: "Hello", text: " brave new", source: "ai_editor" }]);
    const { container } = renderPair(pair);
    const total = pair.segments.reduce((n, s) => n + (s.end - s.start), 0);
    const aiPct = ((" brave new".length / total) * 100).toFixed(1);
    expect(container.textContent).toContain(`AI-generated (editor): ${aiPct}%`);
    expect(container.textContent).toContain("Typed by user:");
  });

  it("no provenance map: the notice, not a blank panel", () => {
    const { container } = render(
      <FlowHighlightedText segments={[]} writingContent="<p>Some text</p>" onClose={() => {}} />,
    );
    expect(container.textContent).toContain("No provenance data available.");
    expect(container.textContent).not.toContain("Some text");
  });
});
