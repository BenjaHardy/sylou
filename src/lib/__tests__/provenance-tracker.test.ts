import { describe, it, expect, beforeEach, vi } from "vitest";
import { Mapping, StepMap } from "@tiptap/pm/transform";
import { ProvenanceTracker, type ProvenanceSegment } from "@/lib/provenance-tracker";

/**
 * Minimal duck-typed ProseMirror transaction stub.
 * applyTransaction only needs: mapping.map, mapping.maps[i].forEach, doc.content.size, doc.textBetween.
 *
 * For these tests we model the simplest possible insertion at a fixed point:
 *   old doc:   [0, oldSize)
 *   insertion of `insertLen` chars at position `at`
 *   new doc:   [0, oldSize + insertLen)
 */
function makeInsertionTx(opts: {
  oldSize: number;
  at: number;
  insertLen: number;
  insertText: string;
  surroundingText?: string; // full text of new doc (optional, for textBetween)
}) {
  const { oldSize, at, insertLen, insertText, surroundingText } = opts;
  const newSize = oldSize + insertLen;

  // Map old position → new position
  const mapPos = (pos: number, bias = 0) => {
    if (pos < at) return pos;
    if (pos > at) return pos + insertLen;
    // pos === at: bias -1 keeps left, bias +1 shifts right
    return bias < 0 ? pos : pos + insertLen;
  };

  const stepMap = {
    forEach: (fn: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void) => {
      fn(at, at, at, at + insertLen);
    },
  };

  const fullText = surroundingText ?? "x".repeat(oldSize).slice(0, at) + insertText + "x".repeat(Math.max(0, oldSize - at));

  return {
    mapping: {
      map: (pos: number, bias?: number) => mapPos(pos, bias ?? 0),
      maps: [stepMap],
      // Single-step stub: slice(1) over one step = empty mapping = identity.
      slice: (_from: number) => ({ map: (pos: number, _bias?: number) => pos }),
    },
    doc: {
      content: { size: newSize },
      textBetween: (from: number, to: number, _sep: string) => fullText.slice(from, Math.min(to, fullText.length)),
    },
  };
}

function seed(tracker: ProvenanceTracker, segments: ProvenanceSegment[]) {
  tracker.init(segments, segments.length ? segments[segments.length - 1].end : 0);
}

describe("ProvenanceTracker.getSegmentSlice", () => {
  let tracker: ProvenanceTracker;
  beforeEach(() => { tracker = new ProvenanceTracker(); });

  it("returns a single slice when range is fully inside one segment", () => {
    seed(tracker, [{ start: 0, end: 100, source: "typed" }]);
    const slice = tracker.getSegmentSlice(10, 30, "hello world");
    expect(slice.totalLength).toBe(20);
    expect(slice.segments).toEqual([
      { offset: 0, length: 20, source: "typed" },
    ]);
  });

  it("returns multiple slices across boundaries", () => {
    seed(tracker, [
      { start: 0, end: 10, source: "typed" },
      { start: 10, end: 25, source: "ai_editor" },
      { start: 25, end: 40, source: "external" },
    ]);
    const slice = tracker.getSegmentSlice(5, 35, "x".repeat(30));
    expect(slice.totalLength).toBe(30);
    expect(slice.segments.map(s => s.source)).toEqual(["typed", "ai_editor", "external"]);
    expect(slice.segments[0]).toMatchObject({ offset: 0, length: 5 });
    expect(slice.segments[1]).toMatchObject({ offset: 5, length: 15 });
    expect(slice.segments[2]).toMatchObject({ offset: 20, length: 10 });
  });

  it("fills uncovered gaps with typed and emits a console.debug", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    seed(tracker, [
      { start: 0, end: 5, source: "ai_editor" },
      { start: 10, end: 15, source: "external" },
    ]);
    const slice = tracker.getSegmentSlice(0, 15, "x".repeat(15));
    expect(slice.segments.map(s => ({ src: s.source, off: s.offset, len: s.length }))).toEqual([
      { src: "ai_editor", off: 0, len: 5 },
      { src: "typed", off: 5, len: 5 },
      { src: "external", off: 10, len: 5 },
    ]);
    expect(debugSpy).toHaveBeenCalledWith(
      "[ProvenanceTracker] uncovered range in getSegmentSlice",
      expect.objectContaining({ gapStart: 5, gapEnd: 10 }),
    );
    debugSpy.mockRestore();
  });
});

describe("ProvenanceTracker.applyTransaction multi-step mapping (P3-11)", () => {
  // Real ProseMirror StepMap/Mapping — the same classes TipTap transactions
  // carry at runtime, so these fixtures use authentic mapping semantics.
  function makeTx(mapping: Mapping, finalText: string) {
    return {
      mapping,
      doc: {
        content: { size: finalText.length },
        textBetween: (from: number, to: number, _sep: string) =>
          finalText.slice(from, Math.min(to, finalText.length)),
      },
    };
  }

  let tracker: ProvenanceTracker;
  beforeEach(() => { tracker = new ProvenanceTracker(); });

  it("single-step replace behaves exactly as before (equivalence guard for typing/paste/AI)", () => {
    seed(tracker, [{ start: 0, end: 20, source: "ai_editor" }]);
    // Replace [4,7) with 5 chars: doc 20 → 22.
    const mapping = new Mapping([new StepMap([4, 3, 5])]);
    tracker.applyTransaction(makeTx(mapping, "x".repeat(22)));
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 4, source: "ai_editor" },
      { start: 4, end: 9, source: "typed" },
      { start: 9, end: 22, source: "ai_editor" },
    ]);
  });

  it("places the second insertion of a two-step transaction at its true final position", () => {
    seed(tracker, [{ start: 0, end: 20, source: "ai_editor" }]);
    // Step 0 inserts 3 chars at 2; step 1 inserts 2 chars at 10 IN STEP-0'S
    // OUTPUT SPACE. Final doc: 25 chars; true inserted ranges [2,5) and
    // [10,12). The old idiom computed [15,17) for the second range
    // (re-applied both steps' shifts to an intermediate coordinate),
    // mis-attributing untouched AI text as typed.
    const mapping = new Mapping([new StepMap([2, 0, 3]), new StepMap([10, 0, 2])]);
    tracker.applyTransaction(makeTx(mapping, "x".repeat(25)));
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 2, source: "ai_editor" },
      { start: 2, end: 5, source: "typed" },
      { start: 5, end: 10, source: "ai_editor" },
      { start: 10, end: 12, source: "typed" },
      { start: 12, end: 25, source: "ai_editor" },
    ]);
  });

  it("drops an insertion that a later step deleted again (no phantom range)", () => {
    seed(tracker, [{ start: 0, end: 20, source: "ai_editor" }]);
    // Step 0 inserts 3 chars at 5; step 1 deletes exactly those 3 chars.
    // The document is unchanged, so the provenance map must be too — the
    // old idiom pushed a phantom [5,8) range and split the segment.
    const mapping = new Mapping([new StepMap([5, 0, 3]), new StepMap([5, 3, 0])]);
    tracker.applyTransaction(makeTx(mapping, "x".repeat(20)));
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 20, source: "ai_editor" },
    ]);
  });
});

describe("ProvenanceTracker.consumeInternalClipboardSlice matching", () => {
  // The stored text and the clipboard text legitimately differ in whitespace
  // SHAPE: raw textBetween without leafText glues hard breaks, TipTap's
  // clipboard serializer emits "\n" for them, and block boundaries arrive as
  // "\n" or "\n\n" depending on the serializer. Matching must be immune.
  it("matches when hard breaks glued the stored text but the clipboard has newlines", () => {
    const tracker = new ProvenanceTracker();
    tracker.setInternalClipboardSlice({ text: "TestHow can I assist", segments: [], totalLength: 20 });
    expect(tracker.consumeInternalClipboardSlice("Test\nHow can I assist")).not.toBeNull();
  });

  it("matches across block-separator shapes (\\n vs \\n\\n)", () => {
    const tracker = new ProvenanceTracker();
    tracker.setInternalClipboardSlice({ text: "alpha\nbeta", segments: [], totalLength: 10 });
    expect(tracker.consumeInternalClipboardSlice("alpha\n\nbeta")).not.toBeNull();
  });

  it("rejects genuinely different content", () => {
    const tracker = new ProvenanceTracker();
    tracker.setInternalClipboardSlice({ text: "hello world", segments: [], totalLength: 11 });
    expect(tracker.consumeInternalClipboardSlice("goodbye world")).toBeNull();
  });
});

describe("ProvenanceTracker slice paste round-trip", () => {
  it("reproduces the source breakdown of a mixed-source selection at the paste point", () => {
    const tracker = new ProvenanceTracker();
    // 30-char doc: [t]0..10 [ai]10..25 [ext]25..30
    seed(tracker, [
      { start: 0, end: 10, source: "typed" },
      { start: 10, end: 25, source: "ai_editor" },
      { start: 25, end: 30, source: "external" },
    ]);

    // Copy chars [5, 28) — spans typed, ai_editor, external (partial on both ends)
    const slice = tracker.getSegmentSlice(5, 28, "x".repeat(23));
    tracker.setInternalClipboardSlice(slice);

    // Simulate paste at position 30 (end of doc). Set slice signal as the
    // paste handler would, then apply a transaction that inserts 23 chars.
    tracker.setPendingSignal({
      kind: "slice",
      segments: slice.segments,
      totalLength: slice.totalLength,
    });
    const tx = makeInsertionTx({ oldSize: 30, at: 30, insertLen: 23, insertText: "x".repeat(23) });
    tracker.applyTransaction(tx);

    const segs = tracker.getSegments();
    // Existing 0..30 unchanged + 3 new segments at 30..53
    const newOnes = segs.filter(s => s.start >= 30);
    expect(newOnes.map(s => s.source)).toEqual(["typed", "ai_editor", "external"]);
    expect(newOnes[0]).toMatchObject({ start: 30, end: 35 });
    expect(newOnes[1]).toMatchObject({ start: 35, end: 50 });
    expect(newOnes[2]).toMatchObject({ start: 50, end: 53 });
  });

  it("clamps the breakdown on a shorter gap — never collapses to the dominant source", () => {
    // Contract since the P3-11 field fix: a gap-vs-slice length mismatch
    // (structural fitting, partial inserts) keeps the multi-source
    // breakdown; pieces are clamped/stretched at the boundaries instead of
    // the old fallback that stamped the whole gap with the dominant source.
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const tracker = new ProvenanceTracker();
    seed(tracker, [{ start: 0, end: 20, source: "typed" }]);

    tracker.setPendingSignal({
      kind: "slice",
      segments: [
        { offset: 0, length: 5, source: "typed" },
        { offset: 5, length: 15, source: "ai_editor" },
      ],
      totalLength: 20,
    });
    // Insert only 10 chars — totalLength (20) != gapLength (10)
    const tx = makeInsertionTx({ oldSize: 20, at: 20, insertLen: 10, insertText: "x".repeat(10) });
    expect(() => tracker.applyTransaction(tx)).not.toThrow();

    // The replayed typed piece [20,25) merges with the typed seed [0,20).
    expect(tracker.getSegments()).toEqual([
      { start: 0, end: 25, source: "typed" },
      { start: 25, end: 30, source: "ai_editor" }, // clamped at gapEnd
    ]);
    debugSpy.mockRestore();
  });

  it("preserves backward compat for single-kind pending signals", () => {
    const tracker = new ProvenanceTracker();
    seed(tracker, [{ start: 0, end: 10, source: "typed" }]);
    tracker.setPendingSignal({ source: "ai_editor" });
    const tx = makeInsertionTx({ oldSize: 10, at: 10, insertLen: 9, insertText: "GENERATED" });
    tracker.applyTransaction(tx);
    const newOnes = tracker.getSegments().filter(s => s.start >= 10);
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0]).toMatchObject({ source: "ai_editor" });
  });

  it("covers an AI multi-node insertion (heading + paragraph w/ bold mark + list) as one contiguous ai_editor region", () => {
    // Simulates what handleAcceptProposal does after parsing markdown like:
    //
    //   # Heading
    //   A paragraph with **bold text** inside.
    //   - list item
    //   - another item
    //
    // into a ProseMirror fragment and inserting it at the end of the doc.
    // The insertion arrives as a SINGLE transaction whose positional length
    // includes block-boundary tokens (h1 open/close, p open/close, ul/li
    // tokens) on top of the text characters and the inline bold mark.
    //
    // The tracker should attribute the entire inserted region — text inside
    // the marked range included — to ai_editor without leaving typed gaps.
    const tracker = new ProvenanceTracker();
    seed(tracker, [{ start: 0, end: 50, source: "typed" }]);

    tracker.setPendingSignal({ source: "ai_editor" });

    // ~120 positions: ~85 chars of visible text + ~35 positions of block
    // wrappers across heading, paragraph, bulletList, and 2 listItems.
    const tx = makeInsertionTx({ oldSize: 50, at: 50, insertLen: 120, insertText: "x".repeat(120) });
    tracker.applyTransaction(tx);

    const segs = tracker.getSegments();
    const inserted = segs.filter(s => s.start >= 50);

    // Single ai_editor segment spanning the whole inserted region — no
    // typed gaps inside (marks are inline within nodes, not separate
    // segments at the provenance layer).
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ start: 50, end: 170, source: "ai_editor" });

    // No typed gap inside [50, 170)
    const gapInside = segs.find(s => s.source === "typed" && s.start >= 50 && s.start < 170);
    expect(gapInside).toBeUndefined();
  });
});
