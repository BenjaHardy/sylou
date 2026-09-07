// TipTap v3 migration — behavior-parity pins for sylou-starter.ts.
//
// v3's StarterKit ships editing behaviors v2 did not have. Sylou opts out
// of each (see sylou-starter.ts); these tests prove every opt-out against
// the v2 outcome — computed on a twin editor by running the exact command
// v2's key binding fell through to (same prosemirror-commands version) —
// and keep a CONTROL for each showing what v3's default would do. A
// failing control means TipTap changed again; a failing parity case means
// an opt-out stopped working.
//
// Keys are driven with real keydown events on the editor DOM: v3's
// editor.commands.keyboardShortcut() replays multi-step handlers through
// a second mapping and silently drops steps, so it is not a faithful stand-in.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Transaction } from "@tiptap/pm/state";
import { sylouStarterKit } from "@/lib/editor-extensions/sylou-starter";
import { buildEditorMarkdownParser, parseMarkdownToFragment } from "@/lib/markdown-to-pm";
import { ProvenanceTracker, type ProvenanceSegment } from "@/lib/provenance-tracker";

const editors: Editor[] = [];

afterEach(() => {
  for (const ed of editors.splice(0)) ed.destroy();
});

/** The app's configuration (all v3-only behaviors opted out). */
function parityEditor(content: string) {
  const ed = new Editor({ element: document.createElement("div"), extensions: sylouStarterKit(), content });
  editors.push(ed);
  return ed;
}

/** v3 StarterKit with only the four schema-shaping flags — the control. */
function v3DefaultsEditor(content: string) {
  const ed = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit.configure({ link: false, underline: false, listKeymap: false, trailingNode: false })],
    content,
  });
  editors.push(ed);
  return ed;
}

function keydown(ed: Editor, key: string, keyCode: number) {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "keyCode", { value: keyCode });
  ed.view.dom.dispatchEvent(ev);
}

function pastePlainText(ed: Editor, text: string) {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", {
    value: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
      types: ["text/plain"],
      files: [],
      items: [],
    },
  });
  ed.view.dom.dispatchEvent(ev);
}

/** Feed doc-changing transactions to a tracker the way WritingEditor does. */
function trackEditor(ed: Editor, tracker: ProvenanceTracker) {
  ed.on("transaction", ({ transaction }: { transaction: Transaction }) => {
    if (!transaction.docChanged) return;
    tracker.applyTransaction({ mapping: transaction.mapping, doc: transaction.doc as never }, true);
  });
}

describe("v2 keymap parity (sylou-starter.ts opt-outs)", () => {
  // <ul><li><p>outer</p><ul><li><p>inner</p><ul>…deep…</ul></li><li><p>inner2</p></li></ul></li><li><p>next</p></li></ul>
  const BRANCHING =
    "<ul><li><p>outer</p><ul><li><p>inner</p><ul><li><p>deep</p></li></ul></li><li><p>inner2</p></li></ul></li><li><p>next</p></li></ul>";
  const END_OF_OUTER = 8; // ul(1) li(2) p(3) "outer" 3..7 → caret after "r"

  it("Delete at the end of a list item before a branching sublist: v2's core chain, not v3's hoist", () => {
    // v2's Delete was core's chain alone (no ListItem binding); run it on
    // the twin to get the v2 outcome (here: joinForward finds no join and
    // the chain ends in selectNodeForward — the list is left intact).
    const twin = parityEditor(BRANCHING);
    twin.commands.setTextSelection(END_OF_OUTER);
    expect(
      twin.commands.first(({ commands }) => [
        () => commands.deleteSelection(),
        () => commands.deleteCurrentNode(),
        () => commands.joinForward(),
        () => commands.selectNodeForward(),
      ]),
    ).toBe(true);
    const v2Outcome = twin.getHTML();
    const v2Selection = twin.state.selection.toJSON();

    const parity = parityEditor(BRANCHING);
    // The nested "inner" item is AI-sourced; it must survive the keystroke.
    const tracker = new ProvenanceTracker();
    const size = parity.state.doc.content.size;
    tracker.init(
      [
        { start: 0, end: 10, source: "typed" },
        { start: 10, end: 17, source: "chat_ai" }, // li + p + "inner"
        { start: 17, end: size, source: "typed" },
      ] as ProvenanceSegment[],
      size,
    );
    trackEditor(parity, tracker);
    parity.commands.setTextSelection(END_OF_OUTER);
    keydown(parity, "Delete", 46);
    expect(parity.getHTML()).toBe(v2Outcome);
    expect(parity.state.selection.toJSON()).toEqual(v2Selection);
    const ai = tracker.getSegments().filter((s) => s.source === "chat_ai");
    expect(ai.length).toBeGreaterThan(0);
    expect(parity.state.doc.textBetween(ai[0].start, ai[0].end, "|")).toContain("inner");

    // Control: v3's bundled branching-Delete keymap hoists the sublist
    // (delete + re-insert) instead.
    const control = v3DefaultsEditor(BRANCHING);
    control.commands.setTextSelection(END_OF_OUTER);
    keydown(control, "Delete", 46);
    expect(control.getHTML()).not.toBe(v2Outcome);
    expect(control.getHTML()).toBe(
      "<ul><li><p>outer</p></li><li><p>inner</p><ul><li><p>deep</p></li></ul></li><li><p>inner2</p></li><li><p>next</p></li></ul>",
    );
  });

  it("Backspace at the start of a quote's second paragraph joins the lines (v2), not lifts it out (v3)", () => {
    const DOC = "<blockquote><p>a</p><p>b</p></blockquote><p>tail</p>";
    const START_OF_B = 5; // bq(1) p(2) "a"(3) /p(4) p(5)
    const twin = parityEditor(DOC);
    twin.commands.setTextSelection(START_OF_B);
    expect(twin.commands.joinBackward()).toBe(true);
    const v2Outcome = twin.getHTML();
    expect(v2Outcome).toBe("<blockquote><p>ab</p></blockquote><p>tail</p>");

    const parity = parityEditor(DOC);
    parity.commands.setTextSelection(START_OF_B);
    keydown(parity, "Backspace", 8);
    expect(parity.getHTML()).toBe(v2Outcome);

    const control = v3DefaultsEditor(DOC);
    control.commands.setTextSelection(START_OF_B);
    keydown(control, "Backspace", 8);
    expect(control.getHTML()).toBe("<blockquote><p>a</p></blockquote><p>b</p><p>tail</p>");
  });

  it("Backspace at the start of the paragraph after a quote pulls it into the quote (v2), not merges its text (v3)", () => {
    const DOC = "<blockquote><p>a</p></blockquote><p>b</p>";
    const START_OF_B = 6; // bq(1) p(2) "a"(3) /p(4) /bq(5) p(6)
    const twin = parityEditor(DOC);
    twin.commands.setTextSelection(START_OF_B);
    expect(twin.commands.joinBackward()).toBe(true);
    const v2Outcome = twin.getHTML();
    expect(v2Outcome).toBe("<blockquote><p>a</p><p>b</p></blockquote>");

    const parity = parityEditor(DOC);
    parity.commands.setTextSelection(START_OF_B);
    keydown(parity, "Backspace", 8);
    expect(parity.getHTML()).toBe(v2Outcome);

    const control = v3DefaultsEditor(DOC);
    control.commands.setTextSelection(START_OF_B);
    keydown(control, "Backspace", 8);
    expect(control.getHTML()).toBe("<blockquote><p>ab</p></blockquote>");
  });

  it("pasting plain text that starts with an ordered-list marker stays literal text (v2), not a list (v3)", () => {
    const parity = parityEditor("<p></p>");
    pastePlainText(parity, "1. Apples\n2. Pears");
    expect(parity.getHTML()).toBe("<p>1. Apples</p><p>2. Pears</p>");

    const control = v3DefaultsEditor("<p></p>");
    pastePlainText(control, "1. Apples\n2. Pears");
    expect(control.getHTML()).toContain("<ol");
  });

  // Not pinned here: CodeBlock's exitOnArrowUp opt-out. Vertical arrow
  // handling needs DOM text measurement (getClientRects), which jsdom lacks;
  // the option's effect is a one-line early return in the extension source.
});

describe("accepted v3 changes (disclosed, pinned)", () => {
  it("Propose-accept of block content at a paragraph start no longer leaves a leading empty paragraph", () => {
    // v2's insertContentAt produced "<p></p><p>Hi there</p><p> world</p>" here
    // (a phantom empty block before the inserted content); v3 shifts the
    // insertion point back by one for block content at a textblock start.
    const ed = parityEditor("<p>Hello world</p>");
    const tracker = new ProvenanceTracker();
    tracker.init([{ start: 0, end: 13, source: "typed" }] as ProvenanceSegment[], 13);
    trackEditor(ed, tracker);

    const fragment = parseMarkdownToFragment(buildEditorMarkdownParser(ed.schema), "Hi there");
    expect(fragment).not.toBeNull();
    tracker.setPendingSignal({ source: "ai_editor" });
    ed.chain().setTextSelection({ from: 1, to: 6 }).insertContent(fragment as never).run();

    expect(ed.getHTML()).toBe("<p>Hi there</p><p> world</p>");
    // The AI text carries its source and the signal was consumed; a typed
    // character afterwards is typed.
    expect(tracker.getSegments().some((s) => s.source === "ai_editor")).toBe(true);
    ed.view.dispatch(ed.state.tr.insertText("!", ed.state.doc.content.size - 1));
    const last = tracker.getSegments().at(-1);
    expect(last?.source).toBe("typed");
  });
});
