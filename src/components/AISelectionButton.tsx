import { useEffect, useState, useCallback, useRef } from "react";
import { Sparkles } from "lucide-react";

interface Props {
  editorElement: HTMLElement | null;
  onOpen: (rect: DOMRect, text: string) => void;
}

export function AISelectionButton({ editorElement, onOpen }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedTextRef = useRef("");
  const selectionRectRef = useRef<DOMRect | null>(null);

  const handleSelectionChange = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      setVisible(false);
      selectedTextRef.current = "";
      return;
    }

    const text = sel.toString().trim();
    if (!text || !editorElement) {
      setVisible(false);
      return;
    }

    // Check selection is inside the editor
    const range = sel.getRangeAt(0);
    if (!editorElement.contains(range.commonAncestorContainer)) {
      setVisible(false);
      return;
    }

    timerRef.current = setTimeout(() => {
      const rect = range.getBoundingClientRect();
      const editorRect = editorElement.getBoundingClientRect();

      selectedTextRef.current = text;
      selectionRectRef.current = rect;

      setPosition({
        top: rect.bottom - editorRect.top + 4,
        left: rect.left - editorRect.left + rect.width / 2,
      });
      setVisible(true);
    }, 300);
  }, [editorElement]);

  useEffect(() => {
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleSelectionChange]);

  if (!visible) return null;

  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (selectionRectRef.current) {
          onOpen(selectionRectRef.current, selectedTextRef.current);
        }
        setVisible(false);
      }}
      className="absolute z-50 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shadow-lg border border-border bg-popover text-popover-foreground hover:bg-accent transition-colors animate-in fade-in-0 zoom-in-95 duration-150"
      style={{
        top: position.top,
        left: position.left,
        transform: "translateX(-50%)",
      }}
    >
      <Sparkles className="h-3.5 w-3.5" />
      Interact with AI
    </button>
  );
}
