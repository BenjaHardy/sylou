import { useEffect, useState, useCallback } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import CharacterCount from "@tiptap/extension-character-count";
import Placeholder from "@tiptap/extension-placeholder";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import { FontSize } from "@/lib/tiptap-font-size";
import { useWritingContent } from "@/hooks/useWritingContent";
import { EditorToolbar } from "@/components/EditorToolbar";
import { Loader2 } from "lucide-react";

interface Props {
  projectId: string;
}

export function WritingEditor({ projectId }: Props) {
  const { content, loading, saveState, updateContent, isDirty, manualSave } = useWritingContent(projectId);
  const [initialSet, setInitialSet] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      CharacterCount,
      Placeholder.configure({ placeholder: "Start writing…" }),
      TextStyle,
      Color,
      FontSize,
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose max-w-none focus:outline-none min-h-full px-8 py-6",
        style: "font-size:16px;line-height:1.6;",
      },
    },
    onUpdate: ({ editor: e }) => {
      updateContent(e.getHTML());
    },
  });

  // Set initial content when loaded
  useEffect(() => {
    if (editor && !loading && !initialSet) {
      editor.commands.setContent(content || "");
      setInitialSet(true);
    }
  }, [editor, loading, content, initialSet]);

  // Reset when projectId changes
  useEffect(() => {
    setInitialSet(false);
  }, [projectId]);

  if (loading || !editor) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const words = editor.storage.characterCount.words();
  const chars = editor.storage.characterCount.characters();

  return (
    <div className="flex flex-col h-full">
      <EditorToolbar editor={editor} />
      <div className="flex-1 overflow-y-auto bg-background">
        <EditorContent editor={editor} className="h-full" />
      </div>
      <div className="h-8 border-t border-border flex items-center justify-between px-4 text-xs text-muted-foreground shrink-0 bg-[hsl(var(--ethos-surface))]">
        <span>
          {words} {words === 1 ? "word" : "words"} · {chars}{" "}
          {chars === 1 ? "character" : "characters"}
        </span>
        <div className="flex items-center gap-3">
          <span>
            {saveState.status === "saving" && "Saving…"}
            {saveState.status === "saved" && !isDirty && "✓ Saved"}
          </span>
          {isDirty ? (
            <button
              onClick={manualSave}
              className="px-2.5 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Save
            </button>
          ) : (
            <span className="px-2.5 py-0.5 rounded text-xs font-medium text-muted-foreground/60">
              Saved
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
