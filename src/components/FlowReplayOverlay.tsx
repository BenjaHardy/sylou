import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Play, Pause, ChevronLeft, ChevronRight } from "lucide-react";
import DOMPurify from "dompurify";

export interface ReplayEvent {
  timestamp: string;
  type: "writing_version" | "chat_message" | "ai_editor_action";
  content: {
    html?: string;
    role?: string;
    content?: string;
    thread_name?: string;
    source_type?: string;
    action_type?: string;
    outcome?: string;
    selected_text_preview?: string;
    ai_response_preview?: string;
  };
}

interface FlowReplayOverlayProps {
  events: ReplayEvent[];
  onClose: () => void;
  sanitize?: boolean;
}

const SPEED_OPTIONS = [1, 2, 5, 10];

const EVENT_COLORS: Record<string, string> = {
  writing_version: "hsl(var(--chart-user))",
  chat_message: "hsl(var(--chart-ai))",
  ai_editor_action: "hsl(var(--chart-editor))",
};

const EVENT_LABELS: Record<string, string> = {
  writing_version: "Writing Version",
  chat_message: "Chat Message (AI)",
  ai_editor_action: "AI Editor Action",
};

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FlowReplayOverlay({ events, onClose, sanitize = false }: FlowReplayOverlayProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // Find nearest writing version at or before current event
  const currentEvent = events[currentIndex];
  const writingHtml = (() => {
    for (let i = currentIndex; i >= 0; i--) {
      if (events[i].type === "writing_version" && events[i].content.html) {
        const html = events[i].content.html!;
        return sanitize ? DOMPurify.sanitize(html) : html;
      }
    }
    return "<p class='text-muted-foreground text-sm italic'>No writing content yet at this point.</p>";
  })();

  // Play/pause
  useEffect(() => {
    if (playing) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= events.length - 1) {
            setPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, 2000 / speed);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [playing, speed, events.length]);

  // Auto-scroll timeline marker into view
  useEffect(() => {
    const container = timelineRef.current;
    if (!container) return;
    const marker = container.querySelector(`[data-index="${currentIndex}"]`) as HTMLElement;
    if (marker) {
      marker.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    }
  }, [currentIndex]);

  const togglePlay = useCallback(() => setPlaying((p) => !p), []);
  const cycleSpeed = useCallback(() => {
    setSpeed((s) => {
      const idx = SPEED_OPTIONS.indexOf(s);
      return SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    });
  }, []);

  const goNext = useCallback(() => {
    setCurrentIndex((i) => Math.min(i + 1, events.length - 1));
  }, [events.length]);

  const goPrev = useCallback(() => {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Top bar */}
      <div className="h-12 border-b border-border flex items-center px-4 gap-3 shrink-0 bg-[hsl(var(--ethos-surface))]">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-1 text-xs">
          <X className="h-4 w-4" />
          Close
        </Button>

        <div className="flex items-center gap-1 ml-auto">
          <Button variant="ghost" size="sm" onClick={goPrev} disabled={currentIndex === 0}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={togglePlay}>
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
          <Button variant="ghost" size="sm" onClick={goNext} disabled={currentIndex === events.length - 1}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" className="text-xs px-2 min-w-[40px]" onClick={cycleSpeed}>
            {speed}x
          </Button>
          <span className="text-xs text-muted-foreground ml-2">
            {currentIndex + 1} / {events.length}
          </span>
        </div>
      </div>

      {/* Timeline */}
      <div className="border-b border-border px-4 py-3 shrink-0">
        <div ref={timelineRef} className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">
          {events.map((evt, i) => (
            <button
              key={i}
              data-index={i}
              onClick={() => setCurrentIndex(i)}
              className="shrink-0 flex flex-col items-center gap-0.5 group"
              title={`${EVENT_LABELS[evt.type]} — ${formatTimestamp(evt.timestamp)}`}
            >
              <div
                className={`transition-all ${
                  i === currentIndex
                    ? "w-4 h-4 ring-2 ring-primary"
                    : "w-2.5 h-2.5 opacity-60 hover:opacity-100"
                } ${evt.type === "ai_editor_action" ? "rotate-45" : ""}`}
                style={{
                  backgroundColor: EVENT_COLORS[evt.type],
                  borderRadius: evt.type === "chat_message" ? "2px" : "50%",
                }}
              />
            </button>
          ))}
        </div>
        {/* Legend */}
        <div className="flex items-center gap-4 mt-2">
          {Object.entries(EVENT_LABELS).map(([type, label]) => (
            <div key={type} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <div
                className={`w-2 h-2 ${type === "ai_editor_action" ? "rotate-45" : ""}`}
                style={{
                  backgroundColor: EVENT_COLORS[type],
                  borderRadius: type === "chat_message" ? "2px" : "50%",
                }}
              />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Split view */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-0 min-h-0">
        {/* Left: Writing content */}
        <ScrollArea className="border-r border-border">
          <div className="p-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Writing at this point
            </h4>
            <div
              className="max-w-none text-sm"
              dangerouslySetInnerHTML={{ __html: writingHtml }}
            />
          </div>
        </ScrollArea>

        {/* Right: Event detail */}
        <ScrollArea>
          <div className="p-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
              Event Detail
            </h4>
            {currentEvent && (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-3 h-3 shrink-0 ${currentEvent.type === "ai_editor_action" ? "rotate-45" : ""}`}
                    style={{
                      backgroundColor: EVENT_COLORS[currentEvent.type],
                      borderRadius: currentEvent.type === "chat_message" ? "2px" : "50%",
                    }}
                  />
                  <span className="text-sm font-medium text-foreground">
                    {EVENT_LABELS[currentEvent.type]}
                  </span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {formatTimestamp(currentEvent.timestamp)}
                  </span>
                </div>

                {currentEvent.type === "writing_version" && (
                  <p className="text-xs text-muted-foreground italic">
                    Writing version saved at this timestamp. The left panel shows the document content.
                  </p>
                )}

                {currentEvent.type === "chat_message" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-foreground capitalize">
                        {currentEvent.content.role}
                      </span>
                      {currentEvent.content.thread_name && (
                        <span className="text-muted-foreground">
                          in {currentEvent.content.thread_name}
                        </span>
                      )}
                      {currentEvent.content.source_type && currentEvent.content.source_type !== "chat" && (
                        <span className="text-muted-foreground">
                          [{currentEvent.content.source_type}]
                        </span>
                      )}
                    </div>
                    <div className="bg-muted/50 rounded-lg p-3">
                      <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                        {currentEvent.content.content}
                      </p>
                    </div>
                  </div>
                )}

                {currentEvent.type === "ai_editor_action" && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-medium text-foreground">
                        {currentEvent.content.action_type}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          currentEvent.content.outcome === "accepted"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                        }`}
                      >
                        {currentEvent.content.outcome}
                      </span>
                    </div>
                    {currentEvent.content.selected_text_preview && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase font-medium">Original</p>
                        <div className="bg-muted/50 rounded p-2">
                          <p className="text-xs text-foreground">{currentEvent.content.selected_text_preview}</p>
                        </div>
                      </div>
                    )}
                    {currentEvent.content.ai_response_preview && (
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase font-medium">AI Result</p>
                        <div className="bg-muted/50 rounded p-2">
                          <p className="text-xs text-foreground">{currentEvent.content.ai_response_preview}</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
