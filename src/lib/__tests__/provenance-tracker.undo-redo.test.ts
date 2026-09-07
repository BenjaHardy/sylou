// Real-editor undo/redo fixtures for the provenance history stacks.
//
// WritingEditor.onUpdate routes every doc-changing transaction one of two
// ways: a transaction carrying the ProseMirror history plugin's "history$"
// meta is an undo/redo and restores a segment snapshot
// (undoProvenance/redoProvenance); anything else goes through
// applyTransaction, which pushes a snapshot first (and clears the redo
// stack, like the editor's own history). This file drives a REAL headless
// editor through typed + AI insertions, undo/redo sequences and a
// post-undo branch, feeding the tracker exactly as WritingEditor does.
//
// It pins two contracts at once: the tracker's stack discipline, and the
// "history$" meta key that ties it to the editor's undo/redo — the
// TipTap v3 migration renames the History extension to UndoRedo, and
// this test proves the underlying prosemirror-history contract survived.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { sylouStarterKit } from "@/lib/editor-extensions/sylou-starter";
import type { Transaction } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { ProvenanceTracker, type ProvenanceSegment } from "@/lib/provenance-tracker";

describe("ProvenanceTracker undo/redo — real editor history transactions", () => {
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
      // WritingEditor's StarterKit configuration (parity with the app).
      extensions: sylouStarterKit(),
      content,
    });
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) captured.push(transaction);
    });
    return editor;
  }

  /** The WritingEditor.onUpdate dispatch, verbatim in spirit. */
  function applyLikeWritingEditor() {
    for (const tr of captured) {
      const historyMeta = tr.getMeta("history$") as { redo?: boolean } | undefined;
      if (historyMeta) {
        if (historyMeta.redo) tracker.redoProvenance();
        else tracker.undoProvenance();
        continue;
      }
      tracker.applyTransaction(
        { mapping: tr.mapping, doc: tr.doc as never },
        tr.getMeta("addToHistory") !== false,
      );
    }
    captured = [];
  }

  function seed(segments: ProvenanceSegment[], size: number) {
    tracker.init(segments, size);
  }

  function text() {
    return editor.state.doc.textBetween(0, editor.state.doc.content.size, "|");
  }

  /** Start a fresh undo group so consecutive synchronous edits don't merge. */
  function newUndoGroup() {
    editor.view.dispatch(closeHistory(editor.state.tr));
  }

  function typeAt(pos: number, s: string) {
    editor.view.dispatch(editor.state.tr.insertText(s, pos));
    applyLikeWritingEditor();
  }

  function aiInsertAt(pos: number, s: string) {
    tracker.setPendingSignal({
      kind: "slice",
      segments: [{ offset: 0, length: s.length, source: "chat_ai" }],
      totalLength: s.length,
    });
    editor.view.dispatch(editor.state.tr.insertText(s, pos));
    applyLikeWritingEditor();
  }

  it("undo/redo in sequence restores the exact segment snapshots (history$ meta contract)", () => {
    makeEditor("<p>base</p>"); // size 6: p(1) + 4 chars + p(1)
    seed([{ start: 0, end: 6, source: "typed" }], 6);

    typeAt(5, " one");
    expect(text()).toBe("base one");
    expect(tracker.getSegments()).toEqual([{ start: 0, end: 10, source: "typed" }]);

    newUndoGroup();
    aiInsertAt(9, " two");
    expect(text()).toBe("base one two");
    // PM positions, not character offsets: the paragraph's closing token
    // (13→14) stays with the surrounding typed segment, so the insertion is
    // carved out of the middle — same shape as the mid-paragraph paste
    // fixture in provenance-tracker.editor.test.ts.
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 9, source: "typed" },
      { start: 9, end: 13, source: "chat_ai" },
      { start: 13, end: 14, source: "typed" },
    ]);

    // Undo the AI insertion, then the typed one.
    expect(editor.commands.undo()).toBe(true);
    applyLikeWritingEditor();
    expect(text()).toBe("base one");
    expect(tracker.getSegments()).toEqual([{ start: 0, end: 10, source: "typed" }]);

    expect(editor.commands.undo()).toBe(true);
    applyLikeWritingEditor();
    expect(text()).toBe("base");
    expect(tracker.getSegments()).toEqual([{ start: 0, end: 6, source: "typed" }]);

    // Redo both, in order.
    expect(editor.commands.redo()).toBe(true);
    applyLikeWritingEditor();
    expect(text()).toBe("base one");
    expect(tracker.getSegments()).toEqual([{ start: 0, end: 10, source: "typed" }]);

    expect(editor.commands.redo()).toBe(true);
    applyLikeWritingEditor();
    expect(text()).toBe("base one two");
    // PM positions, not character offsets: the paragraph's closing token
    // (13→14) stays with the surrounding typed segment, so the insertion is
    // carved out of the middle — same shape as the mid-paragraph paste
    // fixture in provenance-tracker.editor.test.ts.
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 9, source: "typed" },
      { start: 9, end: 13, source: "chat_ai" },
      { start: 13, end: 14, source: "typed" },
    ]);
  });

  it("a new edit after undo clears the redo branch on both the editor and the tracker", () => {
    makeEditor("<p>base</p>");
    seed([{ start: 0, end: 6, source: "typed" }], 6);

    typeAt(5, " one");
    newUndoGroup();
    aiInsertAt(9, " two");

    expect(editor.commands.undo()).toBe(true);
    applyLikeWritingEditor();
    expect(text()).toBe("base one");

    // Branch: type after the undo — the AI redo entry must be gone.
    newUndoGroup();
    typeAt(9, " three");
    expect(text()).toBe("base one three");
    expect(tracker.getSegments()).toEqual([{ start: 0, end: 16, source: "typed" }]);

    expect(editor.commands.redo()).toBe(false); // nothing to redo
    applyLikeWritingEditor(); // no transaction was dispatched
    expect(text()).toBe("base one three");
    expect(tracker.getSegments()).toEqual([{ start: 0, end: 16, source: "typed" }]);

    // And undo still walks back the branch correctly.
    expect(editor.commands.undo()).toBe(true);
    applyLikeWritingEditor();
    expect(text()).toBe("base one");
    expect(tracker.getSegments()).toEqual([{ start: 0, end: 10, source: "typed" }]);
  });

  it("the undo transaction carries the history$ meta the editor relies on", () => {
    makeEditor("<p>base</p>");
    seed([{ start: 0, end: 6, source: "typed" }], 6);
    typeAt(5, " one");

    editor.commands.undo();
    expect(captured).toHaveLength(1);
    const meta = captured[0].getMeta("history$") as { redo?: boolean } | undefined;
    expect(meta).toBeDefined();
    expect(meta?.redo).toBe(false);
    applyLikeWritingEditor();

    editor.commands.redo();
    expect(captured).toHaveLength(1);
    const redoMeta = captured[0].getMeta("history$") as { redo?: boolean } | undefined;
    expect(redoMeta?.redo).toBe(true);
  });
});
