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

export class ProvenanceTracker {
  private segments: ProvenanceSegment[] = [];
  private _pendingAiInsertion = false;
  private _aiResultTexts = new Map<string, number>(); // text -> timestamp
  private _chatClipboardRole: "assistant" | "user" | null = null;
  private _chatClipboardExpiry: ReturnType<typeof setTimeout> | null = null;

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
  }

  getSegments(): ProvenanceSegment[] {
    return this.segments;
  }

  toJSON(): ProvenanceSegment[] {
    return this.segments.map(s => ({ ...s }));
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

  /** Check if pasted text is a known AI result */
  private consumeAiResultText(text: string): boolean {
    if (this._aiResultTexts.has(text)) {
      this._aiResultTexts.delete(text);
      return true;
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

  private consumeChatClipboardRole(): "assistant" | "user" | null {
    const role = this._chatClipboardRole;
    this._chatClipboardRole = null;
    if (this._chatClipboardExpiry) {
      clearTimeout(this._chatClipboardExpiry);
      this._chatClipboardExpiry = null;
    }
    return role;
  }

  // ─── Transaction Handling ────────────────────────────────

  /**
   * Called on every TipTap transaction that changes the document.
   * Adjusts the segment map based on what changed.
   */
  handleTransaction(
    oldLength: number,
    newLength: number,
    changes: { from: number; to: number; insertLength: number; insertedText: string }[]
  ) {
    // Process changes in reverse order (from end to start) to maintain positions
    const sorted = [...changes].sort((a, b) => b.from - a.from);

    for (const change of sorted) {
      const { from, to, insertLength, insertedText } = change;
      const deleteLength = to - from;

      if (deleteLength > 0 && insertLength === 0) {
        // Pure deletion
        this.handleDelete(from, to);
      } else if (deleteLength === 0 && insertLength > 0) {
        // Pure insertion
        const source = this.classifyInsertionFull(insertedText);
        this.handleInsert(from, insertLength, source, insertedText);
      } else if (deleteLength > 0 && insertLength > 0) {
        // Replacement (delete then insert)
        const source = this.classifyInsertionFull(insertedText);
        this.handleDelete(from, to);
        this.handleInsert(from, insertLength, source, insertedText);
      }
    }

    this.mergeAdjacent();
  }

  /** Classify what kind of insertion this is */
  private classifyInsertion(text: string): { source: SegmentSource; originalText: string | null } {
    // Check AI editor programmatic insertion flag first
    if (this._pendingAiInsertion) {
      this._pendingAiInsertion = false;
      return { source: "ai_editor", originalText: text };
    }

    // This will be called during paste handling; check flags set by handlePaste
    // For typed text, default
    return { source: "typed", originalText: null };
  }

  /** Called from paste event handler before the transaction fires */
  classifyPaste(pastedText: string): { source: SegmentSource; originalText: string | null } {
    // 1. Check AI result text match
    if (this.consumeAiResultText(pastedText)) {
      return { source: "ai_editor", originalText: pastedText };
    }

    // 2. Check chat clipboard role
    const chatRole = this.consumeChatClipboardRole();
    if (chatRole === "assistant") {
      return { source: "chat_ai", originalText: pastedText };
    }
    if (chatRole === "user") {
      return { source: "chat_user", originalText: null };
    }

    // 3. External
    return { source: "external", originalText: pastedText };
  }

  /** Temporary override for the next insertion classification */
  private _pasteOverride: { source: SegmentSource; originalText: string | null } | null = null;

  setPasteOverride(override: { source: SegmentSource; originalText: string | null }) {
    this._pasteOverride = override;
  }

  /** Updated classifyInsertion to check paste override */
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
    return { source: "typed", originalText: null };
  }

  // ─── Segment Operations ──────────────────────────────────

  private handleInsert(
    pos: number,
    length: number,
    classification: { source: SegmentSource; originalText: string | null },
    _text: string
  ) {
    const { source, originalText } = classification;
    const newSeg: ProvenanceSegment = {
      start: pos,
      end: pos + length,
      source,
      original_text: originalText,
    };

    if (this.segments.length === 0) {
      this.segments.push(newSeg);
      return;
    }

    // Find which segment contains `pos`
    let idx = this.findSegmentAt(pos);

    if (idx === -1) {
      // Position is at or past the end — append
      // But first shift nothing; just push
      this.segments.push(newSeg);
      return;
    }

    const seg = this.segments[idx];

    // If inserting inside a same-source segment (and it's 'typed'), just extend it
    if (source === "typed" && seg.source === "typed" && pos >= seg.start && pos <= seg.end) {
      seg.end += length;
      // Shift all subsequent segments
      for (let i = idx + 1; i < this.segments.length; i++) {
        this.segments[i].start += length;
        this.segments[i].end += length;
      }
      return;
    }

    // Split the existing segment at `pos` and insert new segment between
    const parts: ProvenanceSegment[] = [];

    if (pos > seg.start) {
      parts.push({ start: seg.start, end: pos, source: seg.source, original_text: seg.original_text });
    }
    parts.push(newSeg);
    if (pos < seg.end) {
      parts.push({ start: pos + length, end: seg.end + length, source: seg.source, original_text: seg.original_text });
    }

    // Shift all subsequent segments
    for (let i = idx + 1; i < this.segments.length; i++) {
      this.segments[i].start += length;
      this.segments[i].end += length;
    }

    this.segments.splice(idx, 1, ...parts);
  }

  private handleDelete(from: number, to: number) {
    const deleteLen = to - from;
    const newSegments: ProvenanceSegment[] = [];

    for (const seg of this.segments) {
      if (seg.end <= from) {
        // Entirely before deletion — keep as-is
        newSegments.push(seg);
      } else if (seg.start >= to) {
        // Entirely after deletion — shift left
        newSegments.push({
          ...seg,
          start: seg.start - deleteLen,
          end: seg.end - deleteLen,
        });
      } else {
        // Segment overlaps with deletion range
        if (seg.start < from) {
          // Part before deletion survives
          newSegments.push({ ...seg, end: from });
        }
        if (seg.end > to) {
          // Part after deletion survives (shifted)
          newSegments.push({
            ...seg,
            start: from,
            end: seg.end - deleteLen,
          });
        }
        // If fully contained, segment is removed (nothing pushed)
      }
    }

    this.segments = newSegments;
  }

  private mergeAdjacent() {
    if (this.segments.length <= 1) return;
    const merged: ProvenanceSegment[] = [this.segments[0]];
    for (let i = 1; i < this.segments.length; i++) {
      const prev = merged[merged.length - 1];
      const curr = this.segments[i];
      if (prev.source === curr.source && prev.end === curr.start) {
        prev.end = curr.end;
        // For non-typed segments, concatenate original_text if both exist
        if (prev.original_text != null && curr.original_text != null) {
          prev.original_text += curr.original_text;
        }
      } else if (curr.start < curr.end) {
        // Only add non-empty segments
        merged.push(curr);
      }
    }
    this.segments = merged;
  }

  private findSegmentAt(pos: number): number {
    for (let i = 0; i < this.segments.length; i++) {
      if (pos >= this.segments[i].start && pos <= this.segments[i].end) {
        return i;
      }
    }
    return -1;
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
