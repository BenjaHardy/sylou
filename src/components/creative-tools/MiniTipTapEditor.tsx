import { useEditor, EditorContent } from "@tiptap/react";
import { sylouStarterKit } from "@/lib/editor-extensions/sylou-starter";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
}

export function MiniTipTapEditor({ value, onChange, placeholder, className }: Props) {
  const isInternalUpdate = useRef(false);

  const editor = useEditor({
    // Plain v2-equivalent StarterKit (v3-only behaviors opted out — see
    // sylou-starter.ts); this editor never had link/underline.
    extensions: sylouStarterKit(),
    content: value || "",
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2 rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          className
        ),
        ...(placeholder ? { "data-placeholder": placeholder } : {}),
      },
    },
    onUpdate: ({ editor: e }) => {
      isInternalUpdate.current = true;
      onChange(e.getHTML());
    },
  });

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const current = editor.getHTML();
    if (current !== value) {
      editor.commands.setContent(value || "", { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}
