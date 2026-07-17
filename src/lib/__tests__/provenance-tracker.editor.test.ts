// Real-editor fixtures for ProvenanceTracker.applyTransaction (P3-11).
//
// These tests drive a REAL headless TipTap editor and feed its actual
// transactions through the tracker, exactly as WritingEditor does. They exist
// because hand-built StepMap stubs proved insufficient: the P3-11 fix was
// first validated only against synthetic fixtures, and the pre-fix idiom's
// real-world failure modes (drag-moves losing the multi-source breakdown,
// list toggles punching bogus `typed` holes into segments) only reproduce
// with authentic multi-step transactions. Any future change to the
// transaction-mapping path must keep these green.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { Transaction } from "@tiptap/pm/state";
import type { Slice } from "@tiptap/pm/model";
import * as pmView from "@tiptap/pm/view";
import { ProvenanceTracker, type ProvenanceSegment } from "@/lib/provenance-tracker";

// prosemirror-view exports its real clipboard parser for exactly this kind of
// test; it is not part of the public type surface, hence the assertion.
const parseFromClipboard = (pmView as unknown as {
  __parseFromClipboard: (
    view: unknown,
    text: string,
    html: string,
    plainText: boolean,
    $context: unknown,
  ) => Slice;
}).__parseFromClipboard;

describe("ProvenanceTracker.applyTransaction — real TipTap transactions", () => {
  let editor: Editor;
  let tracker: ProvenanceTracker;
  let captured: Transaction[];

  beforeEach(() => {
    captured = [];
    tracker = new ProvenanceTracker();
  });

  afterEach(() => {
    editor?.destroy();
  });

  function makeEditor(content: string) {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      content,
    });
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) captured.push(transaction);
    });
    return editor;
  }

  /** Feed captured transactions to the tracker the way WritingEditor does. */
  function applyCaptured() {
    for (const tr of captured) {
      tracker.applyTransaction({ mapping: tr.mapping, doc: tr.doc as never }, true);
    }
    captured = [];
  }

  function seed(segments: ProvenanceSegment[], size: number) {
    tracker.init(segments, size);
  }

  it("paste: replaceSelection mid-paragraph reproduces a mixed slice-signal breakdown", () => {
    makeEditor("<p>aaaaaaaaaa</p>"); // size 12: p(1) + 10 chars + p(1)
    seed([{ start: 0, end: 12, source: "typed" }], 12);

    tracker.setPendingSignal({
      kind: "slice",
      segments: [
        { offset: 0, length: 7, source: "typed" },
        { offset: 7, length: 5, source: "chat_ai" },
      ],
      totalLength: 12,
    });
    editor.commands.setTextSelection(6);
    const paste = editor.state.doc.type.schema.text("xxxxxxxxxxxx");
    editor.view.dispatch(editor.state.tr.replaceSelectionWith(paste, false));
    applyCaptured();

    expect(editor.state.doc.content.size).toBe(24);
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 13, source: "typed" },
      { start: 13, end: 18, source: "chat_ai" },
      { start: 18, end: 24, source: "typed" },
    ]);
  });

  it("drag-move within a paragraph: the moved multi-source breakdown follows the text", () => {
    makeEditor("<p>aaaaaaaaaabbbbbbbbbb</p>"); // size 22
    seed(
      [
        { start: 0, end: 11, source: "typed" },
        { start: 11, end: 22, source: "chat_ai" },
      ],
      22,
    );

    // Drag [6,16) — 5 typed + 5 chat_ai chars — and drop at 19, exactly like
    // prosemirror-view's drop handler for a move: delete source, then
    // replaceRange at the mapped drop position, in ONE two-step transaction.
    const from = 6, to = 16, dropPos = 19;
    const slice = editor.state.doc.slice(from, to);
    const provSlice = tracker.getSegmentSlice(from, to, editor.state.doc.textBetween(from, to, "\n"));
    tracker.setPendingSignal({
      kind: "slice",
      segments: provSlice.segments,
      totalLength: provSlice.totalLength,
    });

    const tr = editor.state.tr;
    tr.deleteRange(from, to);
    const mappedPos = tr.mapping.map(dropPos);
    tr.replaceRange(mappedPos, mappedPos, slice);
    editor.view.dispatch(tr);
    applyCaptured();

    expect(editor.state.doc.textBetween(0, editor.state.doc.content.size, "|")).toBe(
      "aaaaabbbaaaaabbbbbbb",
    );
    // Pre-P3-11, the segment map stayed frozen in place here (breakdown lost).
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 6, source: "typed" },
      { start: 6, end: 9, source: "chat_ai" },
      { start: 9, end: 14, source: "typed" },
      { start: 14, end: 22, source: "chat_ai" },
    ]);
  });

  it("drag-move across paragraphs (open slice): breakdown survives the block-boundary drop", () => {
    makeEditor("<p>aaaaaaaaaa</p><p>bbbbbbbbbb</p><p>cccccccccc</p>"); // size 36
    seed(
      [
        { start: 0, end: 12, source: "typed" },
        { start: 12, end: 24, source: "chat_ai" },
        { start: 24, end: 36, source: "typed" },
      ],
      36,
    );

    // Drag from mid-para1 to mid-para2 (openStart/openEnd = 1) and drop
    // inside para3 — delete + insert land in different coordinate spaces.
    const from = 7, to = 19, dropPos = 30;
    const slice = editor.state.doc.slice(from, to);
    const provSlice = tracker.getSegmentSlice(from, to, editor.state.doc.textBetween(from, to, "\n"));
    tracker.setPendingSignal({
      kind: "slice",
      segments: provSlice.segments,
      totalLength: provSlice.totalLength,
    });

    const tr = editor.state.tr;
    tr.deleteRange(from, to);
    const mappedPos = tr.mapping.map(dropPos);
    tr.replaceRange(mappedPos, mappedPos, slice);
    editor.view.dispatch(tr);
    applyCaptured();

    // Pre-P3-11, every moved chat_ai position ended up `typed` here.
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 7, source: "typed" },
      { start: 7, end: 12, source: "chat_ai" },
      { start: 12, end: 23, source: "typed" },
      { start: 23, end: 30, source: "chat_ai" },
      { start: 30, end: 36, source: "typed" },
    ]);
  });

  it("bullet-list toggle ON and OFF keeps segments glued to their text", () => {
    makeEditor("<p>aaaaaaaaaa</p><p>bbbbbbbbbb</p><p>cccccccccc</p>"); // size 36
    seed(
      [
        { start: 0, end: 12, source: "typed" },
        { start: 12, end: 24, source: "ai_editor" },
        { start: 24, end: 36, source: "typed" },
      ],
      36,
    );

    // Toggle ON: one replaceAround (wrap, two-range step map) + two joins —
    // the multi-step shape that motivated P3-11. Pre-fix, this punched bogus
    // 2-char `typed` holes into the ai_editor segment.
    editor.chain().setTextSelection({ from: 2, to: 34 }).toggleBulletList().run();
    applyCaptured();

    expect(editor.state.doc.content.size).toBe(44);
    let bStart = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text?.startsWith("bbb") && bStart === -1) bStart = pos;
      return true;
    });
    expect(bStart).toBe(17); // the AI text now lives at [17,27)
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 16, source: "typed" },
      { start: 16, end: 28, source: "ai_editor" }, // p_open + b×10 + p_close
      { start: 28, end: 44, source: "typed" },
    ]);

    // Toggle OFF: the inverse multi-step lift restores the exact original map.
    const size2 = editor.state.doc.content.size;
    editor.chain().setTextSelection({ from: 3, to: size2 - 3 }).toggleBulletList().run();
    applyCaptured();

    expect(editor.state.doc.content.size).toBe(36);
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 12, source: "typed" },
      { start: 12, end: 24, source: "ai_editor" },
      { start: 24, end: 36, source: "typed" },
    ]);
  });

  it("paste into an empty paragraph with trailing content (closed-slice fit): the breakdown survives the structural delta", () => {
    // Field bug (P3-11 investigation, reproduced from the user's exact
    // Firefox clipboard payload): when the cursor sits in an EMPTY paragraph
    // that has content after it, prosemirror-view's clipboard parser
    // re-parses the data-pm-slice payload as a CLOSED block, and the
    // insertion carries rebuilt structure — 43 positions for the 36 copied
    // ones (delta +7). The tracker must replay the multi-source breakdown
    // across that gap, never collapse it to the dominant source.
    makeEditor("<p>Test:What can I help you with today?</p><p></p><p>after</p>");
    seed(
      [
        { start: 0, end: 6, source: "typed" },     // p_open + "Test:"
        { start: 6, end: 37, source: "chat_ai" },  // the AI sentence
        { start: 37, end: 47, source: "typed" },   // close + empty p + after-p
      ],
      47,
    );

    // Copy the visible line: 5 typed + 31 chat_ai characters.
    const provSlice = tracker.getSegmentSlice(
      1,
      37,
      editor.state.doc.textBetween(1, 37, "\n", "\n"),
    );
    expect(provSlice.totalLength).toBe(36);
    tracker.setPendingSignal({
      kind: "slice",
      segments: provSlice.segments,
      totalLength: provSlice.totalLength,
    });

    // Paste with the REAL clipboard parser at position 39 (inside the empty
    // middle paragraph), using the exact payload shape ProseMirror writes.
    editor.commands.setTextSelection(39);
    const slice = parseFromClipboard(
      editor.view,
      "Test:What can I help you with today?",
      '<html><body>\n<!--StartFragment--><p data-pm-slice="1 1 []">Test:What can I help you with today?</p><!--EndFragment-->\n</body>\n</html>',
      false,
      editor.state.selection.$from,
    );
    editor.view.dispatch(editor.state.tr.replaceSelection(slice));
    applyCaptured();

    // Breakdown replayed; the typed piece absorbs ~2 leading tokens and the
    // final chat_ai piece stretches over the rebuilt trailing structure —
    // token-scale boundary fuzz instead of a total collapse.
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 6, source: "typed" },
      { start: 6, end: 37, source: "chat_ai" },
      { start: 37, end: 44, source: "typed" },
      { start: 44, end: 82, source: "chat_ai" },
      { start: 82, end: 90, source: "typed" },
    ]);
  });
});
