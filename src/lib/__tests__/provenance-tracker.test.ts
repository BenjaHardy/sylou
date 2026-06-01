import { describe, it, expect, beforeEach, vi } from "vitest";
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
    seed(tracker, [{ start: 0, end: 100, source: "typed", original_text: null }]);
    const slice = tracker.getSegmentSlice(10, 30, "hello world");
    expect(slice.totalLength).toBe(20);
    expect(slice.segments).toEqual([
      { offset: 0, length: 20, source: "typed", original_text: null },
    ]);
  });

  it("returns multiple slices across boundaries", () => {
    seed(tracker, [
      { start: 0, end: 10, source: "typed", original_text: null },
      { start: 10, end: 25, source: "ai_editor", original_text: "AI ORIGINAL" },
      { start: 25, end: 40, source: "external", original_text: "EXT ORIGINAL" },
    ]);
    const slice = tracker.getSegmentSlice(5, 35, "x".repeat(30));
    expect(slice.totalLength).toBe(30);
    expect(slice.segments.map(s => s.source)).toEqual(["typed", "ai_editor", "external"]);
    expect(slice.segments[0]).toMatchObject({ offset: 0, length: 5 });
    expect(slice.segments[1]).toMatchObject({ offset: 5, length: 15 });
    expect(slice.segments[2]).toMatchObject({ offset: 20, length: 10 });
  });

  it("preserves original_text on full-segment coverage", () => {
    seed(tracker, [
      { start: 0, end: 10, source: "typed", original_text: null },
      { start: 10, end: 25, source: "ai_editor", original_text: "AI ORIGINAL" },
    ]);
    const slice = tracker.getSegmentSlice(10, 25, "x".repeat(15));
    expect(slice.segments[0].original_text).toBe("AI ORIGINAL");
  });

  it("drops original_text on partial coverage of an AI segment", () => {
    seed(tracker, [
      { start: 0, end: 10, source: "ai_editor", original_text: "AI ORIGINAL TEN" },
    ]);
    const slice = tracker.getSegmentSlice(2, 8, "x".repeat(6));
    expect(slice.segments[0].source).toBe("ai_editor");
    expect(slice.segments[0].original_text).toBeNull();
  });

  it("fills uncovered gaps with typed and emits a console.debug", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    seed(tracker, [
      { start: 0, end: 5, source: "ai_editor", original_text: "AI" },
      { start: 10, end: 15, source: "external", original_text: "EXT" },
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

describe("ProvenanceTracker slice paste round-trip", () => {
  it("reproduces the source breakdown of a mixed-source selection at the paste point", () => {
    const tracker = new ProvenanceTracker();
    // 30-char doc: [t]0..10 [ai]10..25 [ext]25..30
    seed(tracker, [
      { start: 0, end: 10, source: "typed", original_text: null },
      { start: 10, end: 25, source: "ai_editor", original_text: "AI ORIGINAL_15" },
      { start: 25, end: 30, source: "external", original_text: "EXT_5" },
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
    expect(newOnes[1]).toMatchObject({ start: 35, end: 50, original_text: "AI ORIGINAL_15" });
    expect(newOnes[2]).toMatchObject({ start: 50, end: 53, original_text: null });
  });

  it("degrades gracefully on length mismatch (single dominant segment, no throw)", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    const tracker = new ProvenanceTracker();
    seed(tracker, [{ start: 0, end: 20, source: "typed", original_text: null }]);

    tracker.setPendingSignal({
      kind: "slice",
      segments: [
        { offset: 0, length: 5, source: "typed", original_text: null },
        { offset: 5, length: 15, source: "ai_editor", original_text: null }, // dominant
      ],
      totalLength: 20,
    });
    // Insert only 10 chars — totalLength (20) != gapLength (10)
    const tx = makeInsertionTx({ oldSize: 20, at: 20, insertLen: 10, insertText: "x".repeat(10) });
    expect(() => tracker.applyTransaction(tx)).not.toThrow();

    const newOnes = tracker.getSegments().filter(s => s.start >= 20);
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0]).toMatchObject({ start: 20, end: 30, source: "ai_editor", original_text: null });
    debugSpy.mockRestore();
  });

  it("preserves backward compat for single-kind pending signals", () => {
    const tracker = new ProvenanceTracker();
    seed(tracker, [{ start: 0, end: 10, source: "typed", original_text: null }]);
    tracker.setPendingSignal({ source: "ai_editor", originalText: "GENERATED" });
    const tx = makeInsertionTx({ oldSize: 10, at: 10, insertLen: 9, insertText: "GENERATED" });
    tracker.applyTransaction(tx);
    const newOnes = tracker.getSegments().filter(s => s.start >= 10);
    expect(newOnes).toHaveLength(1);
    expect(newOnes[0]).toMatchObject({ source: "ai_editor", original_text: "GENERATED" });
  });
});
