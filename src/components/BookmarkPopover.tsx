import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import type { Bookmark } from "@/hooks/useBookmarks";

const BOOKMARK_COLORS = [
  { name: "blue", class: "bg-blue-500" },
  { name: "green", class: "bg-green-500" },
  { name: "yellow", class: "bg-yellow-500" },
  { name: "red", class: "bg-red-500" },
  { name: "purple", class: "bg-purple-500" },
];

interface Props {
  bookmark: Bookmark;
  onUpdate: (id: string, updates: { color?: string; annotation?: string }) => void;
  onDelete: (id: string) => void;
  children: React.ReactNode;
}

export function BookmarkPopover({ bookmark, onUpdate, onDelete, children }: Props) {
  const [annotation, setAnnotation] = useState(bookmark.annotation ?? "");

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-56 p-3 space-y-3" side="left" align="start">
        {/* Color picker */}
        <div className="flex items-center gap-2">
          {BOOKMARK_COLORS.map((c) => (
            <button
              key={c.name}
              onClick={() => onUpdate(bookmark.id, { color: c.name })}
              className={`h-5 w-5 rounded-full ${c.class} transition-transform ${
                bookmark.color === c.name ? "ring-2 ring-offset-2 ring-primary scale-110" : "hover:scale-110"
              }`}
              aria-label={c.name}
            />
          ))}
        </div>

        {/* Annotation */}
        <textarea
          value={annotation}
          onChange={(e) => setAnnotation(e.target.value)}
          onBlur={() => onUpdate(bookmark.id, { annotation })}
          placeholder="Add a note…"
          rows={2}
          className="w-full resize-none rounded border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
        />

        {/* Delete */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs"
          onClick={() => onDelete(bookmark.id)}
        >
          <Trash2 className="h-3 w-3 mr-1.5" />
          Remove bookmark
        </Button>
      </PopoverContent>
    </Popover>
  );
}
