import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { ChevronDown, Plus, Check, X, MoreHorizontal, Pencil } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { ChatThread } from "@/hooks/useChatThread";

interface Props {
  threads: ChatThread[];
  activeThreadId: string | null;
  onSelect: (threadId: string) => void;
  onCreate: (name: string) => void;
  onRename: (threadId: string, newName: string) => void;
}

export function ChatThreadSelector({ threads, activeThreadId, onSelect, onCreate, onRename }: Props) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId);

  useEffect(() => {
    if (creating && createInputRef.current) {
      createInputRef.current.focus();
    }
  }, [creating]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleCreate = () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setNewName("");
    setCreating(false);
    setOpen(false);
  };

  const handleCreateKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") { setCreating(false); setNewName(""); }
  };

  const handleRenameSubmit = () => {
    if (!editingId) return;
    const trimmed = editName.trim();
    if (trimmed && trimmed !== threads.find((t) => t.id === editingId)?.name) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
    setEditName("");
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleRenameSubmit();
    if (e.key === "Escape") { setEditingId(null); setEditName(""); }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1 text-sm font-medium text-foreground hover:text-primary transition-colors rounded px-1.5 py-0.5 hover:bg-accent/50 max-w-[180px]">
          <span className="truncate">{activeThread?.name ?? "Main"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1.5">
        <div className="space-y-0.5 max-h-60 overflow-y-auto">
          {threads.map((thread) => (
            <div key={thread.id} className="group">
              {editingId === thread.id ? (
                <div className="flex items-center gap-1 px-2 py-1">
                  <input
                    ref={editInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={handleRenameSubmit}
                    className="flex-1 text-sm bg-transparent border border-primary/30 rounded px-1.5 py-0.5 outline-hidden focus:ring-1 focus:ring-primary/40"
                  />
                  <button onClick={handleRenameSubmit} className="text-primary hover:text-primary/80">
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => { setEditingId(null); setEditName(""); }} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center group/row">
                  <button
                    onClick={() => { onSelect(thread.id); setOpen(false); }}
                    className={`flex-1 text-left text-sm px-2 py-1.5 rounded transition-colors ${
                      thread.id === activeThreadId
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-foreground hover:bg-accent/50"
                    }`}
                  >
                    {thread.name}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover/row:opacity-100 transition-opacity p-1 rounded hover:bg-accent/50 text-muted-foreground hover:text-foreground mr-1">
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(thread.id);
                          setEditName(thread.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-2" />
                        Rename
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-border mt-1.5 pt-1.5">
          {creating ? (
            <div className="flex items-center gap-1 px-2">
              <input
                ref={createInputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={handleCreateKeyDown}
                onBlur={() => { if (!newName.trim()) setCreating(false); }}
                placeholder="Thread name…"
                className="flex-1 text-sm bg-transparent border border-primary/30 rounded px-1.5 py-0.5 outline-hidden focus:ring-1 focus:ring-primary/40 placeholder:text-muted-foreground"
              />
              <button onClick={handleCreate} className="text-primary hover:text-primary/80">
                <Check className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-1.5 h-7 text-xs text-muted-foreground"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-3.5 w-3.5" />
              New Thread
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
