/**
 * ProvenanceTracker — tracks the origin of every text segment in the editor.
 *
 * Segment sources:
 *   typed       [t]   — user typed
 *   chat_ai     [cc]  — copied from chat assistant message
 *   chat_user   [t]   — copied from chat user message (maps to typed in annotations)
 *   ai_editor   [ai]  — inserted via TextSelectionWindow (Accept/Modify)
 *   external    [ce]  — pasted from external source
 */

export type SegmentSource = "typed" | "chat_ai" | "chat_user" | "ai_editor" | "external";

export interface ProvenanceSegment {
  start: number;
  end: number;
  source: SegmentSource;
  original_text: string | null;
}

const MAX_HISTORY = 100;

export class ProvenanceTracker {
  private segments: ProvenanceSegment[] = [];
  private _pendingAiInsertion = false;
  private _aiResultTexts = new Map<string, number>(); // text -> timestamp
  private _chatClipboardRole: "assistant" | "user" | null = null;
  private _chatClipboardExpiry: ReturnType<typeof setTimeout> | null = null;

  /**
   * Internal editor clipboard — stores text + dominant source when user
   * copies/cuts within the TipTap editor. Persists until overwritten by
   * the next copy/cut event (users may paste multiple times).
   */
  private _internalClipboard: { text: string; source: SegmentSource } | null = null;

  /** Drag-and-drop override — set before drop transaction fires */
  private _dragOverride: { source: SegmentSource; originalText: string | null } | null = null;

  /** Skip tracking flag — used during programmatic content resets */
  private _skipTracking = false;

  /** Undo/redo history stacks for provenance segments */
  private _undoStack: ProvenanceSegment[][] = [];
  private _redoStack: ProvenanceSegment[][] = [];

  // ─── Initialization ──────────────────────────────────────

  /** Load segments from DB or initialize for existing content */
  init(savedSegments: ProvenanceSegment[] | null, contentLength: number) {
    if (savedSegments && savedSegments.length > 0) {
      this.segments = savedSegments;
      // Ensure coverage up to current content length
      this.clampToLength(contentLength);
    } else if (contentLength > 0) {
      this.segments = [{ start: 0, end: contentLength, source: "typed", original_text: null }];
    } else {
      this.segments = [];
    }
    // Reset history on init
    this._undoStack = [];
    this._redoStack = [];
  }

  getSegments(): ProvenanceSegment[] {
    return this.segments;
  }

  toJSON(): ProvenanceSegment[] {
    return this.segments.map(s => ({ ...s }));
  }

  // ─── Skip Tracking (for programmatic content resets) ─────

  setSkipTracking(skip: boolean) {
    this._skipTracking = skip;
  }

  isSkipTracking(): boolean {
    return this._skipTracking;
  }

  // ─── Undo/Redo History ──────────────────────────────────

  /** Push current segments to undo stack (called before normal edits) */
  private pushHistory() {
    this._undoStack.push(this.segments.map(s => ({ ...s })));
    if (this._undoStack.length > MAX_HISTORY) {
      this._undoStack.shift();
    }
    // Any new edit clears redo
    this._redoStack = [];
  }

  /** Restore segments from undo stack */
  undoProvenance() {
    const prev = this._undoStack.pop();
    if (prev) {
      this._redoStack.push(this.segments.map(s => ({ ...s })));
      this.segments = prev;
    }
  }

  /** Restore segments from redo stack */
  redoProvenance() {
    const next = this._redoStack.pop();
    if (next) {
      this._undoStack.push(this.segments.map(s => ({ ...s })));
      this.segments = next;
    }
  }

  // ─── Internal Editor Clipboard ──────────────────────────

  /** Called on copy/cut within the editor to record the dominant source of the selection */
  setInternalClipboard(text: string, source: SegmentSource) {
    this._internalClipboard = { text, source };
  }

  /**
   * Returns the dominant provenance source for a given character range.
   */
  getDominantSource(from: number, to: number): SegmentSource {
    if (from >= to) return "typed";

    const coverage = new Map<SegmentSource, number>();

    for (const seg of this.segments) {
      if (seg.end <= from || seg.start >= to) continue;
      const overlapStart = Math.max(seg.start, from);
      const overlapEnd = Math.min(seg.end, to);
      const len = overlapEnd - overlapStart;
      if (len > 0) {
        coverage.set(seg.source, (coverage.get(seg.source) ?? 0) + len);
      }
    }

    if (coverage.size === 0) return "typed";

    let best: SegmentSource = "typed";
    let bestLen = 0;
    for (const [source, len] of coverage) {
      if (len > bestLen) {
        best = source;
        bestLen = len;
      }
    }
    return best;
  }

  /**
   * Returns a human-readable source breakdown string for a given character range.
   * E.g., "85% [t], 15% [ce]". Merges chat_user into typed for display.
   */
  getSourceBreakdown(from: number, to: number): string {
    if (from >= to) return "100% [t]";

    const coverage = new Map<SegmentSource, number>();
    for (const seg of this.segments) {
      if (seg.end <= from || seg.start >= to) continue;
      const overlapStart = Math.max(seg.start, from);
      const overlapEnd = Math.min(seg.end, to);
      const len = overlapEnd - overlapStart;
      if (len > 0) {
        coverage.set(seg.source, (coverage.get(seg.source) ?? 0) + len);
      }
    }

    if (coverage.size === 0) return "100% [t]";

    // Merge chat_user into typed for display
    const displayMap = new Map<string, number>();
    const tagMap: Record<string, string> = {
      typed: "[t]",
      chat_user: "[t]",
      chat_ai: "[cc]",
      ai_editor: "[ai]",
      external: "[ce]",
    };

    for (const [source, len] of coverage) {
      const tag = tagMap[source] ?? `[${source}]`;
      displayMap.set(tag, (displayMap.get(tag) ?? 0) + len);
    }

    const totalLen = Array.from(displayMap.values()).reduce((a, b) => a + b, 0);
    const entries = Array.from(displayMap.entries())
      .map(([tag, len]) => ({ tag, pct: Math.round((len / totalLen) * 100) }))
      .filter(e => e.pct > 0)
      .sort((a, b) => b.pct - a.pct);

    return entries.map(e => `${e.pct}% ${e.tag}`).join(", ");
  }

  /**
   * Check (without clearing) if pasted text matches the internal editor clipboard.
   * Returns the stored source or null if no match.
   */
  private checkInternalClipboard(pastedText: string): SegmentSource | null {
    if (!this._internalClipboard) return null;
    const normalize = (t: string) => t.trim().replace(/\s+/g, " ");
    if (normalize(pastedText) === normalize(this._internalClipboard.text)) {
      return this._internalClipboard.source;
    }
    return null;
  }

  // ─── AI Editor Flags ─────────────────────────────────────

  /** Call before programmatic insertion from TextSelectionWindow */
  setPendingAiInsertion() {
    this._pendingAiInsertion = true;
  }

  /** Register an AI result text for manual copy/paste detection */
  registerAiResultText(text: string) {
    const now = Date.now();
    this._aiResultTexts.set(text, now);
    // Auto-expire after 300s
    setTimeout(() => {
      if (this._aiResultTexts.get(text) === now) {
        this._aiResultTexts.delete(text);
      }
    }, 300_000);
  }

  /** Check if pasted text is a known AI result (with normalized + substring matching) */
  private consumeAiResultText(text: string): boolean {
    // Exact match first
    if (this._aiResultTexts.has(text)) {
      return true;
    }
    // Normalized match — trim + collapse whitespace
    const normalize = (t: string) => t.trim().replace(/\s+/g, " ");
    const normalizedPaste = normalize(text);
    for (const [registered] of this._aiResultTexts) {
      if (normalize(registered) === normalizedPaste) {
        return true;
      }
    }
    // Substring match — only for pasted text >= 20 chars
    if (normalizedPaste.length >= 20) {
      for (const [registered] of this._aiResultTexts) {
        if (normalize(registered).includes(normalizedPaste)) {
          return true;
        }
      }
    }
    return false;
  }

  // ─── Chat Clipboard Tagging ──────────────────────────────

  /** Called when user copies text from the chat panel */
  setChatClipboardRole(role: "assistant" | "user") {
    this._chatClipboardRole = role;
    if (this._chatClipboardExpiry) clearTimeout(this._chatClipboardExpiry);
    // Expire after 30s — user should paste quickly
    this._chatClipboardExpiry = setTimeout(() => {
      this._chatClipboardRole = null;
    }, 30_000);
  }

  /** Check chat clipboard role without clearing it (supports multiple pastes) */
  private checkChatClipboardRole(): "assistant" | "user" | null {
    return this._chatClipboardRole;
  }

  // ─── Drag-and-Drop Override ──────────────────────────────

  /** Set before a drop transaction fires, with the dominant source of the dragged range */
  setDragOverride(override: { source: SegmentSource; originalText: string | null }) {
    this._dragOverride = override;
  }

  private consumeDragOverride(): { source: SegmentSource; originalText: string | null } | null {
    const o = this._dragOverride;
    this._dragOverride = null;
    return o;
  }

  // ─── Transaction Handling (Mapping-Based) ────────────────

  /**
   * Apply a ProseMirror transaction to the segment map using the
   * transaction's own mapping and step maps.
   *
   * Steps:
   * 1. Map all existing segment positions through the transaction mapping
   * 2. Extract insertion ranges from step maps and split absorbed segments
   * 3. Fill gaps (newly inserted content) with classified segments
   * 4. Merge adjacent same-source segments
   */
  applyTransaction(
    transaction: {
      mapping: {
        map: (pos: number, bias?: number) => number;
        maps: readonly { forEach: (fn: (oldStart: number, oldEnd: number, newStart: number, newEnd: number) => void) => void }[];
      };
      doc: { content: { size: number }; textBetween: (from: number, to: number, blockSeparator: string) => string };
    },
    pushToHistory = true,
  ) {
    if (this._skipTracking) return;

    // Push to history stack before modifying (for undo support)
    if (pushToHistory) {
      this.pushHistory();
    }

    const mapping = transaction.mapping;
    const newDocSize = transaction.doc.content.size;

    // Step 1: Map existing segments through the transaction mapping
    const mapped: ProvenanceSegment[] = [];
    for (const seg of this.segments) {
      const newStart = mapping.map(seg.start, 1); // bias right for start
      const newEnd = mapping.map(seg.end, -1);     // bias left for end
      if (newEnd > newStart) {
        mapped.push({
          start: newStart,
          end: newEnd,
          source: seg.source,
          original_text: seg.original_text,
        });
      }
      // If newEnd <= newStart, segment was fully deleted — drop it
    }

    // Sort mapped segments by start position
    mapped.sort((a, b) => a.start - b.start);

    // Step 2: Extract insertion ranges from step maps and split segments
    // that absorbed insertions they shouldn't own.
    const hasSignal = !!(this._pasteOverride || this._pendingAiInsertion || this._dragOverride);
    const insertionRanges: Array<{ start: number; end: number }> = [];

    const maps = mapping.maps;
    for (let i = 0; i < maps.length; i++) {
      maps[i].forEach((oldStart: number, oldEnd: number, newStart: number, newEnd: number) => {
        const newLen = newEnd - newStart;
        if (newLen > 0) {
          const finalStart = mapping.map(oldStart, -1);
          const insertionLength = newLen;
          const finalEnd = finalStart + insertionLength;
          insertionRanges.push({ start: finalStart, end: finalEnd });
        }
      });
    }

    // Deduplicate overlapping insertion ranges
    if (insertionRanges.length > 1) {
      insertionRanges.sort((a, b) => a.start - b.start);
      const deduped: typeof insertionRanges = [insertionRanges[0]];
      for (let i = 1; i < insertionRanges.length; i++) {
        const prev = deduped[deduped.length - 1];
        const curr = insertionRanges[i];
        if (curr.start <= prev.end) {
          prev.end = Math.max(prev.end, curr.end);
        } else {
          deduped.push(curr);
        }
      }
      insertionRanges.length = 0;
      insertionRanges.push(...deduped);
    }

    // Split segments that absorbed insertions.
    const splitMapped: ProvenanceSegment[] = [];
    for (const seg of mapped) {
      let current = seg;
      let didSplit = false;

      for (const ins of insertionRanges) {
        if (ins.start >= current.start && ins.end <= current.end && ins.start < ins.end) {
          const shouldSplit = hasSignal || current.source !== "typed";
          if (!shouldSplit) continue;

          didSplit = true;
          if (ins.start > current.start) {
            splitMapped.push({
              start: current.start,
              end: ins.start,
              source: current.source,
              original_text: current.original_text,
            });
          }
          if (ins.end < current.end) {
            current = {
              start: ins.end,
              end: current.end,
              source: current.source,
              original_text: current.original_text,
            };
            didSplit = false;
          } else {
            current = { ...current, start: current.end, end: current.end };
            break;
          }
        }
      }

      if (current.end > current.start) {
        splitMapped.push(current);
      }
    }

    // Step 3: Identify gaps and fill with classified segments
    const result: ProvenanceSegment[] = [];
    let cursor = 0;

    for (const seg of splitMapped) {
      const segStart = Math.max(seg.start, cursor);
      const segEnd = Math.min(seg.end, newDocSize);

      if (segStart > cursor) {
        const gapText = this.extractText(transaction.doc, cursor, segStart);
        const classification = this.classifyGap(gapText);
        result.push({
          start: cursor,
          end: segStart,
          source: classification.source,
          original_text: classification.originalText,
        });
      }

      if (segEnd > segStart) {
        result.push({ ...seg, start: segStart, end: segEnd });
      }

      cursor = Math.max(cursor, segEnd);
    }

    // Fill trailing gap
    if (cursor < newDocSize) {
      const gapText = this.extractText(transaction.doc, cursor, newDocSize);
      const classification = this.classifyGap(gapText);
      result.push({
        start: cursor,
        end: newDocSize,
        source: classification.source,
        original_text: classification.originalText,
      });
    }

    this.segments = result;

    // Step 4: Merge adjacent same-source segments
    this.mergeAdjacent();
  }

  /**
   * Safely extract text from a ProseMirror doc node.
   */
  private extractText(
    doc: { textBetween: (from: number, to: number, blockSeparator: string) => string; content: { size: number } },
    from: number,
    to: number
  ): string {
    try {
      const clampedTo = Math.min(to, doc.content.size);
      if (from >= clampedTo) return "";
      return doc.textBetween(from, clampedTo, "");
    } catch {
      return "";
    }
  }

  /**
   * Classify a gap (newly inserted content) using the existing
   * classification priority: pending AI flag → paste override →
   * drag override → internal clipboard → AI result registry →
   * chat clipboard → typed.
   */
  private classifyGap(text: string): { source: SegmentSource; originalText: string | null } {
    return this.classifyInsertionFull(text);
  }


  /** Called from paste event handler before the transaction fires */
  classifyPaste(pastedText: string): { source: SegmentSource; originalText: string | null } {
    // 1. Check AI result text match
    if (this.consumeAiResultText(pastedText)) {
      return { source: "ai_editor", originalText: pastedText };
    }

    // 2. Check chat clipboard role (not consumed — supports multiple pastes)
    const chatRole = this.checkChatClipboardRole();
    if (chatRole === "assistant") {
      return { source: "chat_ai", originalText: pastedText };
    }
    if (chatRole === "user") {
      return { source: "chat_user", originalText: null };
    }

    // 3. Check internal editor clipboard (not consumed — supports multiple pastes)
    const internalSource = this.checkInternalClipboard(pastedText);
    if (internalSource) {
      const originalText = internalSource === "typed" || internalSource === "chat_user"
        ? null
        : pastedText;
      return { source: internalSource, originalText };
    }

    // 4. External
    return { source: "external", originalText: pastedText };
  }

  /** Temporary override for the next insertion classification */
  private _pasteOverride: { source: SegmentSource; originalText: string | null } | null = null;

  setPasteOverride(override: { source: SegmentSource; originalText: string | null }) {
    this._pasteOverride = override;
  }

  /** Classify inserted text using priority: AI flag → paste override → drag override → typed */
  private classifyInsertionFull(text: string): { source: SegmentSource; originalText: string | null } {
    if (this._pendingAiInsertion) {
      this._pendingAiInsertion = false;
      return { source: "ai_editor", originalText: text };
    }
    if (this._pasteOverride) {
      const o = this._pasteOverride;
      this._pasteOverride = null;
      return o;
    }
    if (this._dragOverride) {
      const o = this._dragOverride;
      this._dragOverride = null;
      return o;
    }
    return { source: "typed", originalText: null };
  }

  // ─── Segment Operations ──────────────────────────────────

  private mergeAdjacent() {
    if (this.segments.length <= 1) return;
    const merged: ProvenanceSegment[] = [this.segments[0]];
    for (let i = 1; i < this.segments.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = this.segments[i];
      if (prev.source === curr.source && prev.end === curr.start) {
        prev.end = curr.end;
        if (prev.original_text != null && curr.original_text != null) {
          prev.original_text += curr.original_text;
        }
      } else if (curr.start < curr.end) {
        merged.push(curr);
      }
    }
    this.segments = merged;
  }

  private clampToLength(len: number) {
    // Remove/trim segments beyond content length
    this.segments = this.segments
      .map(s => ({
        ...s,
        start: Math.min(s.start, len),
        end: Math.min(s.end, len),
      }))
      .filter(s => s.start < s.end);

    // Ensure coverage to `len`
    if (this.segments.length === 0 && len > 0) {
      this.segments.push({ start: 0, end: len, source: "typed", original_text: null });
    } else if (this.segments.length > 0) {
      const last = this.segments[this.segments.length - 1];
      if (last.end < len) {
        if (last.source === "typed") {
          last.end = len;
        } else {
          this.segments.push({ start: last.end, end: len, source: "typed", original_text: null });
        }
      }
    }
  }
}
