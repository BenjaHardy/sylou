import { useState, useMemo } from "react";
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
const WRITE_COLORS: Record<SegmentSource, { bg: string; label: string; tag: string }> = {
  typed:     { bg: "bg-green-200/60 dark:bg-green-800/40",   label: "Typed by user",             tag: "[t]" },
  chat_ai:   { bg: "bg-red-200/60 dark:bg-red-800/40",      label: "Copied from AI chat",       tag: "[cc]" },
  chat_user: { bg: "bg-green-200/60 dark:bg-green-800/40",   label: "Typed by user",             tag: "[t]" },
  ai_editor: { bg: "bg-blue-200/60 dark:bg-blue-800/40",    label: "AI-generated (editor)",     tag: "[ai]" },
  external:  { bg: "bg-gray-200/60 dark:bg-gray-700/40",    label: "External source",           tag: "[ce]" },
};

/* ─── Clipboard Mode: classify by input method ─── */
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
  if (mode === "write") {
    const items = [
      { bg: "bg-green-400", label: "Typed [t]" },
      { bg: "bg-red-400", label: "AI Chat [cc]" },
      { bg: "bg-blue-400", label: "AI Editor [ai]" },
      { bg: "bg-gray-400", label: "External [ce]" },
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

  const items = [
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

/* ─── Segment Span ─── */
function SegmentSpan({
  text,
  segment,
  totalLength,
  mode,
}: {
  text: string;
  segment: ProvenanceSegment;
  totalLength: number;
  mode: HighlightMode;
}) {
  const pct = totalLength > 0 ? ((text.length / totalLength) * 100).toFixed(1) : "0";

  if (mode === "write") {
    const style = WRITE_COLORS[segment.source];
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={`${style.bg} rounded-sm px-px cursor-default`}>
              {text}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs max-w-xs">
            <p className="font-semibold">{style.label} {style.tag}</p>
            <p className="text-muted-foreground">{pct}% of total text</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  const cat = getClipboardCategory(segment.source);
  const style = CLIPBOARD_COLORS[cat];
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={`${style.bg} rounded-sm px-px cursor-default`}>
            {text}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-xs">
          <p className="font-semibold">{style.label}</p>
          <p className="text-muted-foreground">{pct}% of total text</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/* ─── Main Component ─── */
export function FlowHighlightedText({ segments, writingContent, onClose }: Props) {
  const [mode, setMode] = useState<HighlightMode>("write");

  // Strip HTML tags to get plain text, preserving basic structure
  const plainText = useMemo(() => {
    const div = document.createElement("div");
    div.innerHTML = writingContent;
    return div.textContent || div.innerText || "";
  }, [writingContent]);

  const totalLength = plainText.length;

  // Build rendered segments
  const rendered = useMemo(() => {
    if (!segments || segments.length === 0) {
      return <span className="text-muted-foreground italic">No provenance data available.</span>;
    }

    return segments.map((seg, i) => {
      const text = plainText.slice(seg.start, seg.end);
      if (!text) return null;
      return (
        <SegmentSpan
          key={`${i}-${seg.start}`}
          text={text}
          segment={seg}
          totalLength={totalLength}
          mode={mode}
        />
      );
    });
  }, [segments, plainText, totalLength, mode]);

  // Stats
  const stats = useMemo(() => {
    if (!segments || segments.length === 0) return null;
    const counts: Record<string, number> = {};
    for (const seg of segments) {
      const key = mode === "write" ? seg.source : getClipboardCategory(seg.source);
      const len = Math.min(seg.end, totalLength) - seg.start;
      if (len > 0) counts[key] = (counts[key] || 0) + len;
    }
    return counts;
  }, [segments, totalLength, mode]);

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
        {stats && totalLength > 0 && (
          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            {Object.entries(stats).map(([key, count]) => {
              const pct = ((count / totalLength) * 100).toFixed(1);
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
        <div className="text-sm leading-relaxed whitespace-pre-wrap break-words font-mono text-foreground">
          {rendered}
        </div>
      </div>
    </div>
  );
}
