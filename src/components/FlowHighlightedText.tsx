import { useMemo, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Eye, X } from "lucide-react";
import type { ProvenanceSegment, SegmentSource } from "@/lib/provenance-tracker";
import { parseWritingHtml } from "@/lib/parse-writing-html";

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

/* ─── Legend ─── */
function Legend() {
  const items = [
    { bg: "bg-green-400", label: "Typed" },
    { bg: "bg-red-400", label: "AI Chat" },
    { bg: "bg-blue-400", label: "AI Editor" },
    { bg: "bg-gray-400", label: "External" },
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

/* HTML void elements — cannot have children or dangerouslySetInnerHTML.
 * Treated as atomic leaf nodes (size 1 in ProseMirror positions). */
const VOID_TAGS = new Set([
  "AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG",
  "INPUT", "LINK", "META", "SOURCE", "TRACK", "WBR",
]);


/**
 * Recursively walk a DOM tree, tracking TipTap-compatible positions.
 */
function walkNode(
  node: Node,
  pos: number,
  segments: ProvenanceSegment[],
  totalTextLen: number,
  keyPrefix: string,
): { nodes: ReactNode[]; pos: number; textLen: number } {
  const results: ReactNode[] = [];
  let currentPos = pos;
  let textLen = 0;

  if (node.nodeType === Node.TEXT_NODE) {
    const raw = node.textContent || "";
    if (raw.length === 0) return { nodes: [], pos: currentPos, textLen: 0 };

    let offset = 0;
    while (offset < raw.length) {
      const charPos = currentPos + offset;
      const seg = findSegmentAt(segments, charPos);

      let runEnd = raw.length;
      if (seg) {
        runEnd = Math.min(raw.length, offset + (seg.end - charPos));
      } else {
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
          const style = WRITE_COLORS[seg.source];

          results.push(
            <TooltipProvider key={`${keyPrefix}-${offset}`} delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className={`${style.bg} rounded-sm px-px cursor-default`}>
                    {chunk}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs max-w-xs">
                  <p className="font-semibold">{style.label}</p>
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
    const isVoid = VOID_TAGS.has(tagName);
    const isBlock = !isVoid && BLOCK_TAGS.has(tagName);

    // Void elements (hr, br, img, ...) are atomic leaf nodes in ProseMirror,
    // contributing exactly 1 position. They cannot have children, so we render
    // them self-closing. If the position falls inside a provenance segment,
    // wrap in a styled span (the wrapper, not the void, carries the highlight).
    if (isVoid) {
      const seg = findSegmentAt(segments, currentPos);
      const Tag = tagName.toLowerCase() as keyof JSX.IntrinsicElements;
      const className =
        tagName === "HR" ? "my-3 border-border" :
        tagName === "BR" ? "" :
        "inline-block";
      const voidEl = <Tag key={`${keyPrefix}-void`} className={className || undefined} />;

      if (seg) {
        const style = WRITE_COLORS[seg.source];
        const pct = totalTextLen > 0 ? ((1 / totalTextLen) * 100).toFixed(1) : "0";
        results.push(
          <TooltipProvider key={`${keyPrefix}-void-wrap`} delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`${style.bg} rounded-sm`}>{voidEl}</span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-xs">
                <p className="font-semibold">{style.label}</p>
                <p className="text-muted-foreground">{pct}% of total text</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      } else {
        results.push(voidEl);
      }

      currentPos += 1;
      return { nodes: results, pos: currentPos, textLen: 0 };
    }



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
        `${keyPrefix}-${i}`,
      );
      childNodes.push(...result.nodes);
      currentPos = result.pos;
      childTextLen += result.textLen;
    }

    if (isBlock) currentPos += 1;

    if (isBlock) {
      const Tag = tagName.toLowerCase() as keyof JSX.IntrinsicElements;
      results.push(
        <Tag key={`${keyPrefix}-el`} className={tagName === "P" ? "mb-2" : tagName.startsWith("H") ? "mb-3 font-bold" : "mb-2"}>
          {childNodes}
        </Tag>
      );
    } else {
      results.push(...childNodes);
    }

    textLen = childTextLen;
    return { nodes: results, pos: currentPos, textLen };
  }

  return { nodes: results, pos: currentPos, textLen };
}

/* ─── Main Component ─── */
export function FlowHighlightedText({ segments, writingContent, onClose }: Props) {
  const totalTextLen = useMemo(() => {
    if (!segments || segments.length === 0) return 0;
    let total = 0;
    for (const seg of segments) {
      total += seg.end - seg.start;
    }
    return total;
  }, [segments]);

  const rendered = useMemo(() => {
    if (!segments || segments.length === 0) {
      return <span className="text-muted-foreground italic">No provenance data available.</span>;
    }

    const container = parseWritingHtml(writingContent);

    // Walk the container's children directly — the parsed <body> is NOT part of
    // the ProseMirror document tree, so treating it as a block node would shift
    // all positions by +1 and cause segment boundaries to drift.
    const allNodes: ReactNode[] = [];
    let pos = 0;
    const children = container.childNodes;
    for (let i = 0; i < children.length; i++) {
      const result = walkNode(children[i], pos, segments, totalTextLen, `root-${i}`);
      allNodes.push(...result.nodes);
      pos = result.pos;
    }
    return allNodes;
  }, [segments, writingContent, totalTextLen]);

  const stats = useMemo(() => {
    if (!segments || segments.length === 0) return null;
    const counts: Record<string, number> = {};
    for (const seg of segments) {
      const len = seg.end - seg.start;
      if (len > 0) counts[seg.source] = (counts[seg.source] || 0) + len;
    }
    return counts;
  }, [segments]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-4 shrink-0 gap-3 bg-[hsl(var(--ethos-surface))]">
        <Eye className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Text Provenance</span>

        <div className="ml-auto">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Legend + Stats */}
      <div className="px-4 py-3 border-b border-border space-y-2">
        <Legend />
        {stats && totalTextLen > 0 && (
          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            {Object.entries(stats).map(([key, count]) => {
              const pct = ((count / totalTextLen) * 100).toFixed(1);
              const label = WRITE_COLORS[key as SegmentSource]?.label ?? key;
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
        <div className="text-sm leading-relaxed wrap-break-word font-mono text-foreground">
          {rendered}
        </div>
      </div>
    </div>
  );
}
