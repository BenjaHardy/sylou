import { useMemo } from "react";
import { BookmarkIcon, X } from "lucide-react";
import type { Bookmark } from "@/hooks/useBookmarks";
import type { ChatMessage } from "@/hooks/useChatMessages";

const COLOR_DOT: Record<string, string> = {
  blue: "bg-blue-500",
  green: "bg-green-500",
  yellow: "bg-yellow-500",
  red: "bg-red-500",
  purple: "bg-purple-500",
};

interface Thread {
  id: string;
  name: string;
}

interface Props {
  bookmarks: Bookmark[];
  threads: Thread[];
  allMessages: Record<string, ChatMessage[]>;
  onNavigate: (threadId: string, messageId: string) => void;
  onClose: () => void;
}

export function BookmarkListPanel({ bookmarks, threads, allMessages, onNavigate, onClose }: Props) {
  const grouped = useMemo(() => {
    const map = new Map<string, { thread: Thread; items: Bookmark[] }>();
    for (const bm of bookmarks) {
      if (!map.has(bm.thread_id)) {
        const thread = threads.find((t) => t.id === bm.thread_id) ?? { id: bm.thread_id, name: "Unknown" };
        map.set(bm.thread_id, { thread, items: [] });
      }
      map.get(bm.thread_id)!.items.push(bm);
    }
    return Array.from(map.values());
  }, [bookmarks, threads]);

  const getMessagePreview = (messageId: string): string => {
    for (const msgs of Object.values(allMessages)) {
      const msg = msgs.find((m) => m.id === messageId);
      if (msg) return msg.content.slice(0, 50) + (msg.content.length > 50 ? "…" : "");
    }
    return "(message not loaded)";
  };

  return (
    <div className="absolute inset-0 z-10 bg-[hsl(var(--ethos-surface))] flex flex-col">
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2">
          <BookmarkIcon className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Bookmarks</span>
        </div>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {bookmarks.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BookmarkIcon className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No bookmarks yet.</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Hover over a chat message and click the bookmark icon to add one.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {grouped.map(({ thread, items }) => (
              <div key={thread.id}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-2 w-2 rounded-sm bg-primary/60" />
                  <span className="text-xs font-bold text-foreground uppercase tracking-wider">{thread.name}</span>
                </div>
                <div className="space-y-1 pl-4">
                  {items.map((bm) => (
                    <button
                      key={bm.id}
                      onClick={() => onNavigate(bm.thread_id, bm.message_id)}
                      className="w-full text-left flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted/50 transition-colors group"
                    >
                      <div className={`h-2.5 w-2.5 rounded-full ${COLOR_DOT[bm.color] ?? COLOR_DOT.blue} mt-1 shrink-0`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-foreground truncate">{getMessagePreview(bm.message_id)}</p>
                        {bm.annotation && (
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">{bm.annotation}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
