import { useState, useMemo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Eye, Keyboard, Clipboard, X } from "lucide-react";
import type { ProvenanceSegment, SegmentSource } from "@/lib/provenance-tracker";

type HighlightMode = "write" | "clipboard";

interface Props {
  segments: ProvenanceSegment[];
  writingContent: string;
  onClose: () => void;
}

/* ─── Write Mode Colors ─── */
const WRITE_COLORS: Record<SegmentSource, { bg: string; label: string }> = {
  typed:     { bg: "bg-green-200/60 dark:bg-green-800/40",   label: "Typed by user" },
  chat_ai:   { bg: "bg-red-200/60 dark:bg-red-800/40",      label: "Copied from AI chat" },
  chat_user: { bg: "bg-green-200/60 dark:bg-green-800/40",   label: "Typed by user" },
  ai_editor: { bg: "bg-blue-200/60 dark:bg-blue-800/40",    label: "AI-generated (editor)" },
  external:  { bg: "bg-gray-200/60 dark:bg-gray-700/40",    label: "External source" },
};

/* ─── Clipboard Mode ─── */
function getClipboardCategory(source: SegmentSource): "typed" | "chat_paste" | "external_paste" {
  if (source === "typed" || source === "chat_user") return "typed";
  if (source === "chat_ai" || source === "ai_editor") return "chat_paste";
  return "external_paste";
}

const CLIPBOARD_COLORS: Record<string, { bg: string; label: string }> = {
  typed:          { bg: "bg-blue-200/60 dark:bg-blue-800/40",    label: "Typed directly" },
  chat_paste:     { bg: "bg-orange-200/60 dark:bg-orange-800/40", label: "Pasted from chat" },
  external_paste: { bg: "bg-purple-200/60 dark:bg-purple-800/40", label: "Pasted from external" },
};

/* ─── Legend ─── */
function Legend({ mode }: { mode: HighlightMode }) {
  const items = mode === "write"
    ? [
        { bg: "bg-green-400", label: "Typed" },
        { bg: "bg-red-400", label: "AI Chat" },
        { bg: "bg-blue-400", label: "AI Editor" },
        { bg: "bg-gray-400", label: "External" },
      ]
    : [
        { bg: "bg-blue-400", label: "Typed directly" },
        { bg: "bg-orange-400", label: "Pasted from chat" },
        { bg: "bg-purple-400", label: "Pasted from external" },
      ];

  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded-sm ${it.bg}`} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/* ─── Helpers: find segment at a given TipTap position ─── */
function findSegmentAt(segments: ProvenanceSegment[], pos: number): ProvenanceSegment | null {
  for (const seg of segments) {
    if (pos >= seg.start && pos < seg.end) return seg;
  }
  return null;
}

/* Block-level element names (matching TipTap/ProseMirror) */
const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6",
  "BLOCKQUOTE", "UL", "OL", "LI", "PRE",
  "DIV", "HR", "TABLE", "TR", "TD", "TH",
]);

/**
 * Recursively walk a DOM tree, tracking TipTap-compatible positions.
 * Returns { nodes: ReactNode[], pos: number, textLen: number }
 *
 * TipTap position model:
 * - Entering a block node: +1
 * - Leaving a block node: +1
 * - Each text character: +1
 * - Inline nodes don't add structural offsets
 */
function walkNode(
  node: Node,
  pos: number,
  segments: ProvenanceSegment[],
  totalTextLen: number,
  mode: HighlightMode,
  keyPrefix: string,
): { nodes: ReactNode[]; pos: number; textLen: number } {
  const results: ReactNode[] = [];
  let currentPos = pos;
  let textLen = 0;

  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.textContent || "";
    if (raw.length === 0) return { nodes: [], pos: currentPos, textLen: 0 };

    // Split text by segment boundaries and wrap each piece
    let offset = 0;
    while (offset < raw.length) {
      const charPos = currentPos + offset;
      const seg = findSegmentAt(segments, charPos);

      // Determine how many characters belong to this segment
      let runEnd = raw.length;
      if (seg) {
        runEnd = Math.min(raw.length, offset + (seg.end - charPos));
      } else {
        // No segment — find where next segment starts
        for (const s of segments) {
          if (s.start > charPos && s.start - currentPos < runEnd) {
            runEnd = s.start - currentPos;
          }
        }
      }

      const chunk = raw.slice(offset, runEnd);
      if (chunk.length > 0) {
        if (seg) {
          const pct = totalTextLen > 0 ? ((chunk.length / totalTextLen) * 100).toFixed(1) : "0";
          const bgClass = mode === "write"
            ? WRITE_COLORS[seg.source].bg
            : CLIPBOARD_COLORS[getClipboardCategory(seg.source)].bg;
          const label = mode === "write"
            ? WRITE_COLORS[seg.source].label
            : CLIPBOARD_COLORS[getClipboardCategory(seg.source)].label;

          results.push(
            <TooltipProvider key={`${keyPrefix}-${offset}`} delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`${bgClass} rounded-sm px-px cursor-default`}>
                    {chunk}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-xs">
                  <p className="font-semibold">{label}</p>
                  <p className="text-muted-foreground">{pct}% of total text</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          );
        } else {
          results.push(<span key={`${keyPrefix}-${offset}`}>{chunk}</span>);
        }
      }
      offset = runEnd;
    }

    textLen = raw.length;
    currentPos += raw.length;
    return { nodes: results, pos: currentPos, textLen };
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    const tagName = el.tagName;
    const isBlock = BLOCK_TAGS.has(tagName);

    // +1 for entering a block node
    if (isBlock) currentPos += 1;

    const childNodes: ReactNode[] = [];
    let childTextLen = 0;
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const result = walkNode(
        children[i],
        currentPos,
        segments,
        totalTextLen,
        mode,
        `${keyPrefix}-${i}`,
      );
      childNodes.push(...result.nodes);
      currentPos = result.pos;
      childTextLen += result.textLen;
    }

    // +1 for leaving a block node
    if (isBlock) currentPos += 1;

    // Map HTML tag to React element, preserving block structure
    if (isBlock) {
      const Tag = tagName.toLowerCase() as keyof JSX.IntrinsicElements;
      results.push(
        <Tag key={`${keyPrefix}-el`} className={tagName === "P" ? "mb-2" : tagName.startsWith("H") ? "mb-3 font-bold" : "mb-2"}>
          {childNodes}
        </Tag>
      );
    } else {
      // Inline elements (span, strong, em, etc.) — pass through
      results.push(...childNodes);
    }

    textLen = childTextLen;
    return { nodes: results, pos: currentPos, textLen };
  }

  return { nodes: results, pos: currentPos, textLen };
}

/* ─── Main Component ─── */
export function FlowHighlightedText({ segments, writingContent, onClose }: Props) {
  const [mode, setMode] = useState<HighlightMode>("write");

  // Calculate total text length using TipTap-aware counting
  const totalTextLen = useMemo(() => {
    if (!segments || segments.length === 0) return 0;
    let maxEnd = 0;
    for (const seg of segments) {
      if (seg.end > maxEnd) maxEnd = seg.end;
    }
    // Count actual text chars from segments
    let total = 0;
    for (const seg of segments) {
      total += seg.end - seg.start;
    }
    return total;
  }, [segments]);

  // Build rendered content by walking the HTML DOM
  const rendered = useMemo(() => {
    if (!segments || segments.length === 0) {
      return <span className="text-muted-foreground italic">No provenance data available.</span>;
    }

    const container = document.createElement("div");
    container.innerHTML = writingContent;

    // Start at position 0; the doc node itself adds +1 in TipTap but
    // our segments are stored relative to content start (pos 1 in ProseMirror = our 0 typically).
    // We start at 0 and the first <p> entering adds +1, matching TipTap's scheme where
    // the first text char inside the first <p> is at position 1.
    const { nodes } = walkNode(container, 0, segments, totalTextLen, mode, "root");
    return nodes;
  }, [segments, writingContent, totalTextLen, mode]);

  // Stats
  const stats = useMemo(() => {
    if (!segments || segments.length === 0) return null;
    const counts: Record<string, number> = {};
    for (const seg of segments) {
      const key = mode === "write" ? seg.source : getClipboardCategory(seg.source);
      const len = seg.end - seg.start;
      if (len > 0) counts[key] = (counts[key] || 0) + len;
    }
    return counts;
  }, [segments, mode]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-4 shrink-0 gap-3 bg-[hsl(var(--ethos-surface))]">
        <Eye className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Text Provenance</span>

        {/* Mode toggle */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant={mode === "write" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-3 gap-1.5"
            onClick={() => setMode("write")}
          >
            <Keyboard className="h-3 w-3" />
            Write Mode
          </Button>
          <Button
            variant={mode === "clipboard" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-3 gap-1.5"
            onClick={() => setMode("clipboard")}
          >
            <Clipboard className="h-3 w-3" />
            Clipboard Mode
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 ml-2" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Legend + Stats */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <Legend mode={mode} />
        {stats && totalTextLen > 0 && (
          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            {Object.entries(stats).map(([key, count]) => {
              const pct = ((count / totalTextLen) * 100).toFixed(1);
              const label =
                mode === "write"
                  ? WRITE_COLORS[key as SegmentSource]?.label ?? key
                  : CLIPBOARD_COLORS[key]?.label ?? key;
              return (
                <span key={key}>
                  {label}: {pct}%
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Annotated text */}
      <div className="flex-1 overflow-auto px-6 py-4">
        <div className="text-sm leading-relaxed break-words font-mono text-foreground">
          {rendered}
        </div>
      </div>
    </div>
  );
}
