import { useState, useRef, useCallback, useEffect } from "react";
import { Plus, Trash2, X, StickyNote } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PostIt } from "@/hooks/usePostIts";

const COLORS: { name: string; value: string; bg: string }[] = [
  { name: "yellow", value: "yellow", bg: "#FEF3C7" },
  { name: "blue", value: "blue", bg: "#DBEAFE" },
  { name: "green", value: "green", bg: "#D1FAE5" },
  { name: "pink", value: "pink", bg: "#FCE7F3" },
  { name: "purple", value: "purple", bg: "#EDE9FE" },
];

function getColorBg(color: string) {
  return COLORS.find((c) => c.value === color)?.bg ?? "#FEF3C7";
}

interface PostItNoteProps {
  postIt: PostIt;
  onUpdate: (id: string, updates: Partial<Pick<PostIt, "content" | "color">>) => void;
  onUpdatePosition: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  canvasBounds: DOMRect | null;
}

function PostItNote({ postIt, onUpdate, onUpdatePosition, onDelete, canvasBounds }: PostItNoteProps) {
  const [dragging, setDragging] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const noteRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Don't start drag from textarea or buttons
      if ((e.target as HTMLElement).closest("textarea, button")) return;
      e.preventDefault();
      setDragging(true);
      const rect = noteRef.current!.getBoundingClientRect();
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!canvasBounds) return;
        const newX = Math.max(0, Math.min(ev.clientX - canvasBounds.left - dragOffset.current.x, canvasBounds.width - 170));
        const newY = Math.max(0, Math.min(ev.clientY - canvasBounds.top - dragOffset.current.y, canvasBounds.height - 170));
        onUpdatePosition(postIt.id, Math.round(newX), Math.round(newY));
      };

      const handleMouseUp = () => {
        setDragging(false);
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [canvasBounds, postIt.id, onUpdatePosition]
  );

  return (
    <div
      ref={noteRef}
      className="absolute group/note rounded-md shadow-md flex flex-col select-none"
      style={{
        left: postIt.position_x,
        top: postIt.position_y,
        width: 160,
        minHeight: 160,
        backgroundColor: getColorBg(postIt.color),
        cursor: dragging ? "grabbing" : "grab",
        zIndex: dragging ? 50 : 10,
      }}
      onMouseDown={handleMouseDown}
    >
      {/* Toolbar */}
      <div className="flex items-center justify-between px-1.5 pt-1 opacity-0 group-hover/note:opacity-100 transition-opacity">
        <div className="flex gap-1">
          {COLORS.map((c) => (
            <button
              key={c.value}
              className="w-4 h-4 rounded-full border border-black/10 hover:scale-125 transition-transform"
              style={{ backgroundColor: c.bg }}
              onClick={() => onUpdate(postIt.id, { color: c.value })}
              title={c.name}
            />
          ))}
        </div>
        <button
          className="text-muted-foreground hover:text-destructive transition-colors"
          onClick={() => setShowDeleteConfirm(true)}
          title="Delete note"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Content */}
      <textarea
        className="flex-1 bg-transparent resize-none border-none outline-hidden p-2 text-sm text-foreground placeholder:text-muted-foreground/60 cursor-text min-h-[120px]"
        value={postIt.content}
        onChange={(e) => onUpdate(postIt.id, { content: e.target.value })}
        placeholder="Write a note…"
        onMouseDown={(e) => e.stopPropagation()}
      />

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="absolute inset-0 bg-background/90 rounded-md flex flex-col items-center justify-center gap-2 z-20">
          <p className="text-xs text-foreground font-medium">Delete this note?</p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" className="h-6 text-xs" onClick={() => onDelete(postIt.id)}>
              Delete
            </Button>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

interface PostItsPanelProps {
  postIts: PostIt[];
  loading: boolean;
  onCreate: () => void;
  onUpdate: (id: string, updates: Partial<Pick<PostIt, "content" | "color">>) => void;
  onUpdatePosition: (id: string, x: number, y: number) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function PostItsPanel({ postIts, loading, onCreate, onUpdate, onUpdatePosition, onDelete, onClose }: PostItsPanelProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasBounds, setCanvasBounds] = useState<DOMRect | null>(null);

  // Update bounds on mount and resize via effect + ResizeObserver
  const updateBounds = useCallback(() => {
    if (canvasRef.current) setCanvasBounds(canvasRef.current.getBoundingClientRect());
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    updateBounds();
    const ro = new ResizeObserver(updateBounds);
    ro.observe(el);
    window.addEventListener("resize", updateBounds);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [updateBounds]);

  return (
    <div className="flex-1 flex flex-col bg-background h-full">
      {/* Header */}
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-[hsl(var(--ethos-surface))]">
        <span className="text-sm font-medium text-foreground">Post-it Notes</span>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" />
            New Note
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="flex-1 relative overflow-auto bg-muted/40"
        onMouseEnter={updateBounds}
        style={{
          minHeight: 400,
          backgroundImage: 'radial-gradient(circle, hsl(var(--muted-foreground) / 0.15) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-sm text-muted-foreground">Loading notes…</span>
          </div>
        )}
        {!loading && postIts.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
            <StickyNote className="h-10 w-10 text-muted-foreground/50" />
            <p className="text-base font-medium text-muted-foreground">No post-it notes yet</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              Create your first note
            </Button>
          </div>
        )}
        {postIts.map((p) => (
          <PostItNote
            key={p.id}
            postIt={p}
            onUpdate={onUpdate}
            onUpdatePosition={onUpdatePosition}
            onDelete={onDelete}
            canvasBounds={canvasBounds}
          />
        ))}
      </div>
    </div>
  );
}
