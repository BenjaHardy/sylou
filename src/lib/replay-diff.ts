// Change marks for the Replay tab of a FLOW report: a writing version is
// compared word by word with the version saved before it, and the result is
// marked inside the version's own HTML (added words underlined twice, removed
// words struck through in brackets), so its formatting is kept.
//
// Only the text is compared: a change of formatting alone is not marked.
// Removed words are inserted as text nodes, never as markup, and the marked
// HTML is sanitized again before it is shown.

import DOMPurify from "dompurify";
import { diffWords, diffWordsWithSpace, type ChangeObject, type DiffWordsOptionsAbortable } from "diff";
import { parseWritingHtml } from "@/lib/parse-writing-html";

/** Past this many milliseconds the version is shown unmarked: a near-total
 *  rewrite makes a word diff slow, and a step must not freeze the page. */
const DIFF_TIMEOUT_MS = 300;
/** A removal longer than this many words is folded behind a button. */
const FOLD_ABOVE_WORDS = 40;
/** Words of a folded removal shown before the button. */
const FOLD_PREVIEW_WORDS = 20;

// A double underline, so added words stay distinct from text the writer
// underlined; no colour, so nothing reads as a provenance colour.
export const ADDED_CLASS = "underline decoration-double underline-offset-2";
export const REMOVED_CLASS = "mx-0.5 text-muted-foreground";
export const REMOVED_TEXT_CLASS = "line-through";
const EXPAND_CLASS =
  "ml-1 cursor-pointer rounded-sm border border-border px-1 text-[0.85em] no-underline hover:text-foreground";

export type ChangeStatus = "first" | "changed" | "formatting" | "identical" | "too-many";

export interface WritingChange {
  /** The version's sanitized HTML; marked only when status is "changed". */
  html: string;
  status: ChangeStatus;
  wordsAdded: number;
  wordsRemoved: number;
  wordsBefore: number;
  wordsAfter: number;
}

/** What the Replay's writing panel shows for one step. */
export type WritingStep =
  | { kind: "none" }
  | { kind: "carried"; html: string; savedAt: string }
  | { kind: "version"; savedAt: string; previousSavedAt: string | null; change: WritingChange };

/** The parts of a replay event this module reads. */
export interface ReplayVersionEvent {
  type: string;
  timestamp: string;
  content: { html?: string };
}

const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL",
  "BLOCKQUOTE", "PRE", "DIV", "TABLE", "TR", "TD", "TH",
]);
const BREAK_TAGS = new Set(["BR", "HR"]);
const HAS_WORD = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  let words = 0;
  for (const part of text.split(/\s+/)) if (HAS_WORD.test(part)) words++;
  return words;
}

interface TextRun {
  node: Text;
  /** Where the node's text starts in the flattened text. */
  start: number;
}

/** The document's text with one "\n" between blocks, and where each text
 *  node sits in it. */
function flatten(root: HTMLElement): { text: string; runs: TextRun[] } {
  let text = "";
  const runs: TextRun[] = [];
  const breakLine = () => {
    if (text !== "" && !text.endsWith("\n")) text += "\n";
  };
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      if (textNode.data === "") return;
      runs.push({ node: textNode, start: text.length });
      text += textNode.data;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = (node as Element).tagName;
    if (BREAK_TAGS.has(tag)) {
      breakLine();
      return;
    }
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) breakLine();
    node.childNodes.forEach(walk);
    if (isBlock) breakLine();
  };
  root.childNodes.forEach(walk);
  return { text, runs };
}

interface Marks {
  /** Ranges of the new text to underline. */
  added: Array<{ from: number; to: number }>;
  /** Removed text, anchored before this position of the new text. */
  removed: Array<{ at: number; text: string }>;
  wordsAdded: number;
  wordsRemoved: number;
}

/** Word diff of the two texts, or null past the limits. diffWords reads best
 *  (it ignores spaces when matching words) but does not promise to rebuild
 *  the new text exactly, which the marks rely on; diffWordsWithSpace does. */
function wordChanges(before: string, after: string, limits: DiffWordsOptionsAbortable): ChangeObject<string>[] | null {
  const changes = diffWords(before, after, limits);
  if (!changes) return null;
  const rebuilt = changes.filter((c) => !c.removed).map((c) => c.value).join("");
  return rebuilt === after ? changes : diffWordsWithSpace(before, after, limits) ?? null;
}

interface Edit {
  removed: string;
  added: string;
}
/** Unchanged text, or one edit (what was removed and added at that place). */
type Segment = string | Edit;

function segmentsOf(changes: ChangeObject<string>[]): Segment[] {
  const segments: Segment[] = [];
  for (const change of changes) {
    if (!change.added && !change.removed) {
      segments.push(change.value);
      continue;
    }
    let edit = segments[segments.length - 1];
    if (typeof edit !== "object") {
      edit = { removed: "", added: "" };
      segments.push(edit);
    }
    if (change.added) edit.added += change.value;
    else edit.removed += change.value;
  }
  return segments;
}

const editSize = (edit: Edit) => Math.max(edit.removed.length, edit.added.length);

/** Folds unchanged text less than half the size of the edits on both sides
 *  into them (after the "semantic cleanup" of diff-match-patch), so a
 *  rewritten passage reads as one replacement, not as words that happen to
 *  match ("a", "the"), while a word kept between two small edits stays.
 *  Never across paragraphs. */
function mergeChanceMatches(segments: Segment[]): Segment[] {
  for (let i = 1; i < segments.length - 1; i++) {
    const [before, kept, after] = [segments[i - 1], segments[i], segments[i + 1]];
    if (typeof kept !== "string" || typeof before === "string" || typeof after === "string") continue;
    if (kept.includes("\n") || kept.length * 2 >= editSize(before) || kept.length * 2 >= editSize(after)) continue;
    segments.splice(i - 1, 3, { removed: before.removed + kept + after.removed, added: before.added + kept + after.added });
    i = Math.max(i - 3, 0); // the unchanged text before the merged edit may now qualify
  }
  return segments;
}

function diffMarks(before: string, after: string, limits: DiffWordsOptionsAbortable): Marks | null {
  const changes = wordChanges(before, after, limits);
  if (!changes) return null;
  const marks: Marks = { added: [], removed: [], wordsAdded: 0, wordsRemoved: 0 };
  let pos = 0;
  for (const segment of mergeChanceMatches(segmentsOf(changes))) {
    if (typeof segment === "string") {
      pos += segment.length;
      continue;
    }
    const { removed, added } = segment;
    if (/\S/.test(removed)) {
      marks.removed.push({ at: pos, text: removed });
      marks.wordsRemoved += countWords(removed);
    }
    if (/\S/.test(added)) {
      marks.added.push({
        from: pos + (added.length - added.trimStart().length),
        to: pos + added.trimEnd().length,
      });
      marks.wordsAdded += countWords(added);
    }
    pos += added.length;
  }
  return pos === after.length ? marks : null;
}

/** Index where word number `skip + 1` starts. */
function wordStart(text: string, skip: number): number {
  let seen = 0;
  for (const match of text.matchAll(/\S+/g)) {
    if (!HAS_WORD.test(match[0])) continue;
    if (seen === skip) return match.index ?? text.length;
    seen++;
  }
  return text.length;
}

function removedElement(doc: Document, raw: string): HTMLElement {
  const text = raw.replace(/\s+/g, " ").trim();
  const wrap = doc.createElement("span");
  wrap.className = REMOVED_CLASS;
  wrap.setAttribute("data-replay-change", "removed");
  const del = doc.createElement("del");
  del.className = REMOVED_TEXT_CLASS;
  const words = countWords(text);
  if (words <= FOLD_ABOVE_WORDS) {
    del.textContent = text;
    wrap.append("[", del, "]");
    return wrap;
  }
  const cut = wordStart(text, FOLD_PREVIEW_WORDS);
  del.append(text.slice(0, cut).trimEnd());
  const rest = doc.createElement("span");
  rest.setAttribute("data-replay-rest", "");
  rest.hidden = true;
  rest.textContent = ` ${text.slice(cut)}`;
  del.append(rest);
  const more = doc.createElement("button");
  more.type = "button";
  more.className = EXPAND_CLASS;
  more.setAttribute("data-replay-expand", "");
  more.textContent = `+${(words - FOLD_PREVIEW_WORDS).toLocaleString()} more words`;
  wrap.append("[", del, more, "]");
  return wrap;
}

/** Rebuilds one text node with its marks: underlined slices, and removals
 *  inserted before the character they precede. */
function rebuildRun(
  doc: Document,
  run: TextRun,
  added: Marks["added"],
  removals: Array<{ offset: number; text: string }>,
): void {
  const data = run.node.data;
  const ranges = added
    .map((r) => ({ from: Math.max(r.from - run.start, 0), to: Math.min(r.to - run.start, data.length) }))
    .filter((r) => r.from < r.to);
  if (ranges.length === 0 && removals.length === 0) return;
  const cuts = new Set([0, data.length, ...removals.map((r) => r.offset)]);
  for (const r of ranges) cuts.add(r.from).add(r.to);
  const points = [...cuts].sort((a, b) => a - b);
  const fragment = doc.createDocumentFragment();
  points.forEach((at, i) => {
    for (const removal of removals) if (removal.offset === at) fragment.append(removedElement(doc, removal.text));
    const next = points[i + 1];
    if (next === undefined) return;
    const slice = data.slice(at, next);
    if (ranges.some((r) => r.from <= at && next <= r.to)) {
      const ins = doc.createElement("ins");
      ins.className = ADDED_CLASS;
      ins.setAttribute("data-replay-change", "added");
      ins.textContent = slice;
      fragment.append(ins);
    } else {
      fragment.append(slice);
    }
  });
  run.node.replaceWith(fragment);
}

function applyMarks(root: HTMLElement, runs: TextRun[], marks: Marks): void {
  const doc = root.ownerDocument;
  if (runs.length === 0) {
    // Everything was removed: show the removals in an empty paragraph.
    const p = doc.createElement("p");
    for (const removal of marks.removed) p.append(removedElement(doc, removal.text));
    root.append(p);
    return;
  }
  // Each removal goes before the character at its position; between two
  // blocks, at the start of the next one; past the end, after the last text.
  const removalsByRun = new Map<TextRun, Array<{ offset: number; text: string }>>();
  for (const removal of marks.removed) {
    const inside = runs.find((r) => removal.at >= r.start && removal.at < r.start + r.node.data.length);
    const run = inside ?? runs.find((r) => r.start >= removal.at) ?? runs[runs.length - 1];
    const offset = inside || run.start >= removal.at ? Math.max(removal.at - run.start, 0) : run.node.data.length;
    const list = removalsByRun.get(run) ?? [];
    list.push({ offset, text: removal.text });
    removalsByRun.set(run, list);
  }
  for (const run of runs) rebuildRun(doc, run, marks.added, removalsByRun.get(run) ?? []);
}

/** Marks what changed between two writing versions (HTML as saved). */
export function markChanges(
  previousHtml: string | null,
  currentHtml: string,
  limits: DiffWordsOptionsAbortable = { timeout: DIFF_TIMEOUT_MS },
): WritingChange {
  const body = parseWritingHtml(currentHtml);
  const after = flatten(body);
  const wordsAfter = countWords(after.text);
  if (previousHtml === null) {
    return { html: DOMPurify.sanitize(currentHtml), status: "first", wordsAdded: wordsAfter, wordsRemoved: 0, wordsBefore: 0, wordsAfter };
  }
  const before = flatten(parseWritingHtml(previousHtml)).text;
  const wordsBefore = countWords(before);
  const unmarked = (status: ChangeStatus): WritingChange => ({
    html: DOMPurify.sanitize(currentHtml), status, wordsAdded: 0, wordsRemoved: 0, wordsBefore, wordsAfter,
  });
  if (before === after.text) return unmarked(previousHtml === currentHtml ? "identical" : "formatting");
  const marks = diffMarks(before, after.text, limits);
  if (!marks) return unmarked("too-many");
  if (marks.added.length === 0 && marks.removed.length === 0) return unmarked("formatting");
  applyMarks(body, after.runs, marks);
  return {
    html: DOMPurify.sanitize(body.innerHTML),
    status: "changed",
    wordsAdded: marks.wordsAdded,
    wordsRemoved: marks.wordsRemoved,
    wordsBefore,
    wordsAfter,
  };
}

const versionHtml = (event: ReplayVersionEvent | undefined): string | undefined =>
  event?.type === "writing_version" && event.content.html ? event.content.html : undefined;

/** The writing to show at replay step `index`: the latest version at or
 *  before it, with its changes marked when the step is that version. */
export function writingStepAt(events: readonly ReplayVersionEvent[], index: number): WritingStep {
  let current = Math.min(index, events.length - 1);
  while (current >= 0 && versionHtml(events[current]) === undefined) current--;
  const html = versionHtml(events[current]);
  if (html === undefined) return { kind: "none" };
  if (current !== index) return { kind: "carried", html: DOMPurify.sanitize(html), savedAt: events[current].timestamp };
  let previous = current - 1;
  while (previous >= 0 && versionHtml(events[previous]) === undefined) previous--;
  const previousHtml = versionHtml(events[previous]) ?? null;
  return {
    kind: "version",
    savedAt: events[current].timestamp,
    previousSavedAt: previousHtml === null ? null : events[previous].timestamp,
    change: markChanges(previousHtml, html),
  };
}
