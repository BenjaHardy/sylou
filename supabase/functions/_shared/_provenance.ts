// Provenance-annotation helpers for the FLOW analysis.
//
// Segments are recorded client-side (src/lib/provenance-tracker.ts) in
// ProseMirror POSITION space: each text character counts 1, each block-node
// boundary (open or close) counts 1, leaf nodes (hard break, horizontal rule)
// count 1, and inline marks (bold, italic, links, styled spans, ...) count 0.
// The writing itself is persisted as the editor's HTML string, where a tag
// costs many string characters but 0-1 positions — so slicing the HTML at
// segment offsets drifts by the cumulative tag overhead and can split tags.
//
// annotateWritingWithProvenance() instead walks the HTML while maintaining a
// ProseMirror position counter and inserts the provenance markers exactly
// when the counter reaches each segment boundary. The HTML is copied through
// verbatim; markers are only ever inserted between tokens, never inside a tag.

/** Segment shape as persisted in provenance_events.segment_map. */
export interface ProvenanceSegmentLike {
  start: number;
  end: number;
  source?: string;
  type?: string;
}

/** Map raw segment source/type values to the four canonical categories. */
export function normalizeSource(seg: { source?: string; type?: string }): string {
  const raw = seg.source ?? seg.type ?? "typed";
  switch (raw) {
    case "typed":
    case "chat_user":
      return "typed";
    case "chat_ai":
      return "copy_chat";
    case "ai_editor":
      return "ai";
    case "external":
      return "copy_external";
    // Legacy values that already match the display keys
    case "copy_chat":
    case "copy_external":
    case "ai":
      return raw;
    default:
      return raw;
  }
}

function markerFor(seg: ProvenanceSegmentLike): string {
  const norm = normalizeSource(seg);
  return norm === "typed" ? "[t]"
    : norm === "copy_chat" ? "[cc]"
    : norm === "copy_external" ? "[ce]"
    : norm === "ai" ? "[ai]"
    : `[${norm}]`;
}

// Element classification for Sylou's editor schema (StarterKit + Underline,
// Link, TextAlign, TextStyle/Color/FontSize; Pagination is decoration-only
// and never appears in getHTML() output).
//   block → node: +1 position on open, +1 on close
//   leaf  → void node: +1 position
//   anything else (strong/b/em/i/u/s/code/a/span/...) → mark: 0 positions
const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol", "li", "pre",
]);
const LEAF_TAGS = new Set(["br", "hr"]);

// HTML character entity as serialized by ProseMirror (named, decimal, hex).
// One entity decodes to one text character = one position.
const ENTITY_RE = /^&(?:[a-zA-Z][a-zA-Z0-9]*|#\d+|#x[0-9a-fA-F]+);/;

interface ParsedTag {
  /** Lowercased tag name. */
  name: string;
  isClosing: boolean;
  /** Index just past the terminating '>'. */
  end: number;
}

/** Parse the tag starting at html[i] === "<". Quote-aware, so a raw '>' inside
 *  a quoted attribute value (rare but legal, e.g. in an href) can't truncate
 *  the tag. Returns null when '<' does not open a tag (treat as literal). */
function parseTag(html: string, i: number): ParsedTag | null {
  let j = i + 1;
  let isClosing = false;
  if (html[j] === "/") {
    isClosing = true;
    j++;
  }
  const nameStart = j;
  while (j < html.length && /[a-zA-Z0-9]/.test(html[j])) j++;
  if (j === nameStart) return null; // "<" not followed by a name — literal text
  const name = html.slice(nameStart, j).toLowerCase();

  let quote: string | null = null;
  while (j < html.length) {
    const ch = html[j];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ">") {
      return { name, isClosing, end: j + 1 };
    }
    j++;
  }
  return null; // unterminated tag — treat as literal text
}

/**
 * Insert [t]/[cc]/[ce]/[ai] markers into the saved editor HTML at the correct
 * ProseMirror positions. Matches the legacy output semantics exactly on
 * well-formed data: untracked gaps are prefixed [t], each segment is prefixed
 * with its marker, and a trailing untracked region gets [t] — but marker
 * placement now follows position space instead of HTML string offsets.
 * Segment boundaries beyond the end of the document are dropped.
 */
export function annotateWritingWithProvenance(
  html: string,
  segmentMap: ProvenanceSegmentLike[],
): string {
  if (!segmentMap || segmentMap.length === 0) {
    return `[t]${html}`;
  }

  // Boundary list in position space, mirroring the legacy slicing loop:
  // a [t] at the start of every untracked gap, each segment's marker at its
  // start, and a [t] after the last segment (which only materializes if any
  // content actually follows it).
  const sorted = [...segmentMap].sort((a, b) => a.start - b.start);
  const boundaries: Array<{ pos: number; marker: string }> = [];
  let cursor = 0;
  for (const seg of sorted) {
    if (seg.start > cursor) boundaries.push({ pos: cursor, marker: "[t]" });
    boundaries.push({ pos: seg.start, marker: markerFor(seg) });
    cursor = Math.max(cursor, seg.end);
  }
  boundaries.push({ pos: cursor, marker: "[t]" });

  let out = "";
  let pmPos = 0;
  let bi = 0;
  // Emit every marker due at or before the current position — called right
  // before emitting a unit that OCCUPIES a position, so markers always land
  // immediately ahead of the content they describe and never inside a tag.
  const flushMarkersDue = () => {
    while (bi < boundaries.length && boundaries[bi].pos <= pmPos) {
      out += boundaries[bi].marker;
      bi++;
    }
  };

  let i = 0;
  while (i < html.length) {
    if (html[i] === "<") {
      const tag = parseTag(html, i);
      if (tag) {
        if (BLOCK_TAGS.has(tag.name)) {
          flushMarkersDue();
          pmPos += 1;
        } else if (LEAF_TAGS.has(tag.name) && !tag.isClosing) {
          flushMarkersDue();
          pmPos += 1;
        }
        // Inline/unknown tags occupy no position: copy through, markers wait
        // for the next positional unit so they hug the text they describe.
        out += html.slice(i, tag.end);
        i = tag.end;
        continue;
      }
    }
    // Text: one character (or one entity) = one position.
    flushMarkersDue();
    if (html[i] === "&") {
      const m = ENTITY_RE.exec(html.slice(i));
      if (m) {
        out += m[0];
        pmPos += 1;
        i += m[0].length;
        continue;
      }
    }
    out += html[i];
    pmPos += 1;
    i += 1;
  }

  return out;
}
