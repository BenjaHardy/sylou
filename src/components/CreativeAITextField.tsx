import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { TextSelectionWindow } from "@/components/TextSelectionWindow";
import { useCreativeAI } from "@/contexts/CreativeAIContext";

interface Props {
  sourceModule: "worldbuilding" | "character_chart" | "timeline";
  children: ReactNode;
}

export function CreativeAITextField({ sourceModule, children }: Props) {
  const ctx = useCreativeAI();
  const containerRef = useRef<HTMLDivElement>(null);
  const [buttonVisible, setButtonVisible] = useState(false);
  const [buttonPos, setButtonPos] = useState({ top: 0, left: 0 });
  const [selectionWindow, setSelectionWindow] = useState<{
    text: string;
    rect: DOMRect;
  } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTextRef = useRef("");
  const selectionRectRef = useRef<DOMRect | null>(null);

  const handleSelectionChange = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setButtonVisible(false);
      selectedTextRef.current = "";
      return;
    }

    const text = sel.toString().trim();
    if (!text || !containerRef.current) {
      setButtonVisible(false);
      return;
    }

    const range = sel.getRangeAt(0);
    if (!containerRef.current.contains(range.commonAncestorContainer)) {
      setButtonVisible(false);
      return;
    }

    timerRef.current = setTimeout(() => {
      const rect = range.getBoundingClientRect();
      const containerRect = containerRef.current!.getBoundingClientRect();

      selectedTextRef.current = text;
      selectionRectRef.current = rect;

      setButtonPos({
        top: rect.bottom - containerRect.top + 4,
        left: rect.left - containerRect.left + rect.width / 2,
      });
      setButtonVisible(true);
    }, 300);
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleSelectionChange]);

  const handleOpenWindow = () => {
    if (selectionRectRef.current && selectedTextRef.current) {
      setSelectionWindow({
        text: selectedTextRef.current,
        rect: selectionRectRef.current,
      });
    }
    setButtonVisible(false);
  };

  return (
    <div ref={containerRef} className="relative">
      {children}

      {buttonVisible && !selectionWindow && (
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleOpenWindow();
          }}
          className="absolute z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg border border-border bg-popover text-popover-foreground hover:bg-accent transition-colors animate-in fade-in-0 zoom-in-95 duration-150"
          style={{
            top: buttonPos.top,
            left: buttonPos.left,
            transform: "translateX(-50%)",
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Interact with AI
        </button>
      )}

      {selectionWindow && containerRef.current && (
        <TextSelectionWindow
          selectedText={selectionWindow.text}
          anchorRect={selectionWindow.rect}
          editorElement={containerRef.current}
          tutorMode={ctx.tutorMode}
          projectId={ctx.projectId}
          threadId={ctx.threadId}
          onClose={() => setSelectionWindow(null)}
          onAccept={() => {}} // no-op for creative tools
          onAskComplete={ctx.onAskComplete}
          onChatRefresh={ctx.onChatRefresh}
          conciseMode={ctx.conciseMode}
          setMessages={ctx.chatSetMessages}
          webSearchEnabled={ctx.webSearchEnabled}
          sourceModule={sourceModule}
        />
      )}
    </div>
  );
}
