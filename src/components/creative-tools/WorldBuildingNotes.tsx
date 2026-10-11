import { useState, useCallback, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import { sylouStarterKit } from "@/lib/editor-extensions/sylou-starter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Loader2 } from "lucide-react";
import { CreativeAITextField } from "@/components/CreativeAITextField";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

// --- Types ---

export interface WorldBuildingNote {
  id: string;
  subcategory: string;
  title: string;
  content: string; // HTML
}

export interface WorldBuildingCategory {
  id: string;
  name: string;
  color: string;
  notes: WorldBuildingNote[];
}

export interface WorldBuildingData {
  categories: WorldBuildingCategory[];
}

const SUBCATEGORIES = [
  "Setting",
  "Rules/Systems",
  "History",
  "Culture",
  "Politics",
  "Economics",
  "Technology",
  "Environment",
  "Other",
] as const;

const PRESET_COLORS = [
  "#6366f1", "#8b5cf6", "#ec4899", "#ef4444",
  "#f97316", "#eab308", "#22c55e", "#06b6d4",
  "#3b82f6", "#64748b",
];

const DEFAULT_CATEGORIES: WorldBuildingCategory[] = [
  { id: crypto.randomUUID(), name: "Country", color: "#3b82f6", notes: [] },
  { id: crypto.randomUUID(), name: "Class", color: "#8b5cf6", notes: [] },
  { id: crypto.randomUUID(), name: "Family", color: "#ec4899", notes: [] },
  { id: crypto.randomUUID(), name: "Other", color: "#64748b", notes: [] },
];

interface Props {
  data: WorldBuildingData;
  save: (data: WorldBuildingData) => void;
  loading: boolean;
}

export function WorldBuildingNotes({ data, save, loading }: Props) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ type: "category" | "note"; id: string } | null>(null);

  // Seed defaults on first load
  useEffect(() => {
    if (!loading && (!data.categories || data.categories.length === 0)) {
      save({ categories: DEFAULT_CATEGORIES });
    }
  }, [loading, data, save]);

  const categories = data.categories ?? [];
  const selectedCategory = categories.find((c) => c.id === selectedCategoryId) ?? null;
  const selectedNote = selectedCategory?.notes.find((n) => n.id === selectedNoteId) ?? null;

  // Auto-select first category
  useEffect(() => {
    if (!selectedCategoryId && categories.length > 0) {
      setSelectedCategoryId(categories[0].id);
    }
  }, [categories, selectedCategoryId]);

  const updateCategories = useCallback(
    (updater: (cats: WorldBuildingCategory[]) => WorldBuildingCategory[]) => {
      const updated = updater(categories);
      save({ ...data, categories: updated });
    },
    [categories, data, save]
  );

  // --- Category CRUD ---
  const addCategory = () => {
    const newCat: WorldBuildingCategory = {
      id: crypto.randomUUID(),
      name: "New Category",
      color: PRESET_COLORS[categories.length % PRESET_COLORS.length],
      notes: [],
    };
    updateCategories((cats) => [...cats, newCat]);
    setSelectedCategoryId(newCat.id);
    setEditingCategoryId(newCat.id);
    setEditingCategoryName("New Category");
  };

  const renameCategory = (id: string, name: string) => {
    updateCategories((cats) => cats.map((c) => (c.id === id ? { ...c, name } : c)));
    setEditingCategoryId(null);
  };

  const recolorCategory = (id: string, color: string) => {
    updateCategories((cats) => cats.map((c) => (c.id === id ? { ...c, color } : c)));
  };

  const deleteCategory = (id: string) => {
    updateCategories((cats) => cats.filter((c) => c.id !== id));
    if (selectedCategoryId === id) {
      setSelectedCategoryId(null);
      setSelectedNoteId(null);
    }
  };

  // --- Note CRUD ---
  const addNote = () => {
    if (!selectedCategoryId) return;
    const newNote: WorldBuildingNote = {
      id: crypto.randomUUID(),
      subcategory: "Other",
      title: "Untitled Note",
      content: "",
    };
    updateCategories((cats) =>
      cats.map((c) => (c.id === selectedCategoryId ? { ...c, notes: [...c.notes, newNote] } : c))
    );
    setSelectedNoteId(newNote.id);
  };

  const updateNote = useCallback(
    (noteId: string, updates: Partial<WorldBuildingNote>) => {
      updateCategories((cats) =>
        cats.map((c) =>
          c.id === selectedCategoryId
            ? { ...c, notes: c.notes.map((n) => (n.id === noteId ? { ...n, ...updates } : n)) }
            : c
        )
      );
    },
    [selectedCategoryId, updateCategories]
  );

  const deleteNote = (noteId: string) => {
    updateCategories((cats) =>
      cats.map((c) =>
        c.id === selectedCategoryId ? { ...c, notes: c.notes.filter((n) => n.id !== noteId) } : c
      )
    );
    if (selectedNoteId === noteId) setSelectedNoteId(null);
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) return;
    if (deleteTarget.type === "category") deleteCategory(deleteTarget.id);
    else deleteNote(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        {/* Sidebar — Categories */}
        <ResizablePanel defaultSize={15} minSize={10}>
          <div className="flex flex-col h-full bg-[hsl(var(--ethos-surface))]">
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Categories</span>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={addCategory}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="py-1">
                {categories.map((cat) => (
                  <div
                    key={cat.id}
                    className={`group flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-accent/50 transition-colors ${
                      selectedCategoryId === cat.id ? "bg-accent" : ""
                    }`}
                    onClick={() => {
                      setSelectedCategoryId(cat.id);
                      setSelectedNoteId(null);
                    }}
                  >
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          className="h-3 w-3 rounded-full shrink-0 border border-border hover:ring-2 hover:ring-ring transition-all"
                          style={{ backgroundColor: cat.color }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-2" align="start">
                        <div className="grid grid-cols-5 gap-1">
                          {PRESET_COLORS.map((c) => (
                            <button
                              key={c}
                              className={`h-6 w-6 rounded-full border-2 transition-all ${
                                cat.color === c ? "border-foreground scale-110" : "border-transparent"
                              }`}
                              style={{ backgroundColor: c }}
                              onClick={() => recolorCategory(cat.id, c)}
                            />
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {editingCategoryId === cat.id ? (
                      <form
                        className="flex items-center gap-1 flex-1 min-w-0"
                        onSubmit={(e) => {
                          e.preventDefault();
                          renameCategory(cat.id, editingCategoryName);
                        }}
                      >
                        <Input
                          value={editingCategoryName}
                          onChange={(e) => setEditingCategoryName(e.target.value)}
                          className="h-5 text-xs px-1"
                          autoFocus
                          onBlur={() => renameCategory(cat.id, editingCategoryName)}
                        />
                      </form>
                    ) : (
                      <span className="text-xs text-foreground truncate flex-1">{cat.name}</span>
                    )}

                    <span className="text-[10px] text-muted-foreground">{cat.notes.length}</span>

                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        className="h-4 w-4 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingCategoryId(cat.id);
                          setEditingCategoryName(cat.name);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        className="h-4 w-4 text-muted-foreground hover:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ type: "category", id: cat.id });
                        }}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>

        <ResizableHandle />

        {/* Main — Notes */}
        <ResizablePanel defaultSize={85} minSize={40}>
          <div className="flex-1 flex flex-col h-full min-h-0">
            {selectedCategory ? (
              <>
                <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">{selectedCategory.name}</span>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={addNote}>
                    <Plus className="h-3.5 w-3.5" />
                    Add Note
                  </Button>
                </div>
                <div className="flex-1 flex min-h-0">
                  <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
                    {/* Note list */}
                    <ResizablePanel defaultSize={25} minSize={15}>
                      <ScrollArea className="h-full border-r border-border">
                        <div className="py-1">
                          {selectedCategory.notes.map((note) => (
                            <div
                              key={note.id}
                              className={`px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors group ${
                                selectedNoteId === note.id ? "bg-accent" : ""
                              }`}
                              onClick={() => setSelectedNoteId(note.id)}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <div className="min-w-0">
                                  <p className="text-xs font-medium text-foreground truncate">{note.title}</p>
                                  <p className="text-[10px] text-muted-foreground">{note.subcategory}</p>
                                </div>
                                <button
                                  className="hidden group-hover:block h-4 w-4 text-muted-foreground hover:text-destructive shrink-0 mt-0.5"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleteTarget({ type: "note", id: note.id });
                                  }}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))}
                          {selectedCategory.notes.length === 0 && (
                            <p className="text-xs text-muted-foreground text-center py-4">No notes yet</p>
                          )}
                        </div>
                      </ScrollArea>
                    </ResizablePanel>

                    <ResizableHandle />

                    {/* Note editor */}
                    <ResizablePanel defaultSize={75} minSize={30}>
                      <div className="flex-1 flex flex-col h-full min-h-0">
                        {selectedNote ? (
                          <NoteEditor note={selectedNote} onUpdate={updateNote} />
                        ) : (
                          <div className="flex-1 flex items-center justify-center">
                            <p className="text-xs text-muted-foreground">Select or create a note</p>
                          </div>
                        )}
                      </div>
                    </ResizablePanel>
                  </ResizablePanelGroup>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground">Select or create a category</p>
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.type}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "category"
                ? "This will delete the category and all its notes. This action cannot be undone."
                : "This note will be permanently deleted."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// --- Note Editor sub-component ---

function NoteEditor({
  note,
  onUpdate,
}: {
  note: WorldBuildingNote;
  onUpdate: (noteId: string, updates: Partial<WorldBuildingNote>) => void;
}) {
  const [title, setTitle] = useState(note.title);

  const editor = useEditor(
    {
      // TipTap v3 stops re-rendering on every transaction by default; the
      // mini toolbar's isActive() states below depend on the v2 behavior
      // (caret moves, collapsed-caret mark toggles), so keep it.
      shouldRerenderOnTransaction: true,
      // Plain v2-equivalent StarterKit (v3-only behaviors opted out — see
      // sylou-starter.ts); this editor never had link/underline.
      extensions: sylouStarterKit(),
      content: note.content,
      onUpdate: ({ editor }) => {
        onUpdate(note.id, { content: editor.getHTML() });
      },
    },
    [note.id]
  );

  // Sync title changes back
  useEffect(() => {
    setTitle(note.title);
  }, [note.id, note.title]);

  return (
    <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            onUpdate(note.id, { title: e.target.value });
          }}
          className="text-sm font-medium h-8"
          placeholder="Note title"
        />
        <Select
          value={note.subcategory}
          onValueChange={(v) => onUpdate(note.id, { subcategory: v })}
        >
          <SelectTrigger className="w-[140px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUBCATEGORIES.map((sub) => (
              <SelectItem key={sub} value={sub} className="text-xs">
                {sub}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Mini toolbar */}
      {editor && (
        <div className="flex items-center gap-1 border border-border rounded-md px-1 py-0.5 bg-[hsl(var(--ethos-surface))]">
          <button
            className={`px-1.5 py-0.5 text-xs rounded ${editor.isActive("bold") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            B
          </button>
          <button
            className={`px-1.5 py-0.5 text-xs italic rounded ${editor.isActive("italic") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            I
          </button>
          <button
            className={`px-1.5 py-0.5 text-xs rounded ${editor.isActive("bulletList") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          >
            •
          </button>
          <button
            className={`px-1.5 py-0.5 text-xs rounded ${editor.isActive("orderedList") ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          >
            1.
          </button>
          <button
            className={`px-1.5 py-0.5 text-xs rounded ${editor.isActive("heading", { level: 2 }) ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            H2
          </button>
          <button
            className={`px-1.5 py-0.5 text-xs rounded ${editor.isActive("heading", { level: 3 }) ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            H3
          </button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <CreativeAITextField sourceModule="worldbuilding">
          <EditorContent
            editor={editor}
            className="max-w-none [&_.tiptap]:outline-hidden [&_.tiptap]:min-h-[200px]"
          />
        </CreativeAITextField>
      </ScrollArea>
    </div>
  );
}
