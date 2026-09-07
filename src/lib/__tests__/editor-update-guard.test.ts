// TipTap v3 `update`-event guard and WritingEditor's compensation for it.
//
// v3's Editor.dispatchTransaction only emits `update` when the transaction
// is not flagged preventUpdate, changed the document, AND the resulting
// document differs from the previous one (prevState.doc.eq(state.doc)).
// v2 emitted on docChanged alone. The gap matters to provenance: a paste
// (or a Propose accept) whose text equals the selection replaces the range
// with identical content — under v3 that transaction never reaches
// onUpdate, so the tracker's pending signal armed by the paste/accept
// handler would survive and mis-tag the user's NEXT typed insertion.
//
// WritingEditor closes the gap by re-emitting `update` from onTransaction
// for precisely the suppressed case. These tests pin (1) the v3 contract
// the compensation relies on, (2) that the compensation restores v2's
// behavior for the tracker, and (3) the control: without it, the next
// insertion IS mis-tagged — if a future TipTap release emits `update`
// again for identical documents, (3) fails and the compensation can go.
import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { sylouStarterKit } from "@/lib/editor-extensions/sylou-starter";
import { ProvenanceTracker, type ProvenanceSegment } from "@/lib/provenance-tracker";

let editor: Editor;

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
  return editor;
}

/** WritingEditor's onTransaction compensation, verbatim in spirit. */
function installCompensation(ed: Editor) {
  ed.on("transaction", ({ editor: e, transaction, appendedTransactions }) => {
    if (
      transaction.docChanged &&
      !transaction.getMeta("preventUpdate") &&
      transaction.before.eq(e.state.doc)
    ) {
      e.emit("update", { editor: e, transaction, appendedTransactions });
    }
  });
}

/** WritingEditor's onUpdate provenance dispatch (non-history branch). */
function installTracker(ed: Editor, tracker: ProvenanceTracker) {
  ed.on("update", ({ transaction }) => {
    if (!transaction.docChanged) return;
    tracker.applyTransaction(
      { mapping: transaction.mapping, doc: transaction.doc as never },
      transaction.getMeta("addToHistory") !== false,
    );
  });
}

function replaceWithIdentical(ed: Editor, from: number, to: number) {
  const text = ed.state.doc.textBetween(from, to);
  ed.view.dispatch(ed.state.tr.replaceWith(from, to, ed.schema.text(text)));
}

describe("TipTap v3 update guard", () => {
  it("contract: an identical-document replace fires `transaction` but not `update`; a real change fires both", () => {
    makeEditor("<p>hello world</p>");
    let updates = 0;
    const seen: Array<{ docChanged: boolean; identical: boolean; prevent: unknown }> = [];
    editor.on("update", () => { updates += 1; });
    editor.on("transaction", ({ editor: e, transaction }) => {
      seen.push({
        docChanged: transaction.docChanged,
        identical: transaction.before.eq(e.state.doc),
        prevent: transaction.getMeta("preventUpdate"),
      });
    });

    replaceWithIdentical(editor, 1, 6); // "hello" → "hello"
    expect(seen).toEqual([{ docChanged: true, identical: true, prevent: undefined }]);
    expect(updates).toBe(0);

    editor.view.dispatch(editor.state.tr.insertText("!", 12));
    expect(seen[1]).toEqual({ docChanged: true, identical: false, prevent: undefined });
    expect(updates).toBe(1);
  });

  it("compensation: the identical paste consumes the pending signal (v2 parity) and the next keystroke is typed", () => {
    makeEditor("<p>hello world</p>"); // size 13
    const tracker = new ProvenanceTracker();
    tracker.init([{ start: 0, end: 13, source: "typed" }] as ProvenanceSegment[], 13);
    installCompensation(editor);
    installTracker(editor, tracker);

    // handlePaste arms a signal, then ProseMirror replaces the selection
    // with the (identical) clipboard text.
    tracker.setPendingSignal({ source: "external" });
    replaceWithIdentical(editor, 1, 6);
    // The pasted range carries the paste source, exactly as v2 recorded it.
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 1, source: "typed" },
      { start: 1, end: 6, source: "external" },
      { start: 6, end: 13, source: "typed" },
    ]);

    editor.view.dispatch(editor.state.tr.insertText("!", 12));
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 1, source: "typed" },
      { start: 1, end: 6, source: "external" },
      { start: 6, end: 14, source: "typed" },
    ]);
  });

  it("control: without the compensation the signal survives and mis-tags the next keystroke", () => {
    makeEditor("<p>hello world</p>");
    const tracker = new ProvenanceTracker();
    tracker.init([{ start: 0, end: 13, source: "typed" }] as ProvenanceSegment[], 13);
    installTracker(editor, tracker); // no compensation

    tracker.setPendingSignal({ source: "external" });
    replaceWithIdentical(editor, 1, 6);
    expect(tracker.getSegments()).toEqual([{ start: 0, end: 13, source: "typed" }]); // never consumed

    editor.view.dispatch(editor.state.tr.insertText("!", 12));
    const bang = tracker.getSegments().find((s) => s.start === 12);
    expect(bang?.source).toBe("external"); // the mis-tag the compensation prevents
  });

  it("the load path (emitUpdate: false → preventUpdate) is never re-emitted, even for identical content", () => {
    makeEditor("<p>same</p>");
    let updates = 0;
    editor.on("update", () => { updates += 1; });
    installCompensation(editor);

    editor.commands.setContent("<p>same</p>", { emitUpdate: false });
    expect(updates).toBe(0);
  });
});
