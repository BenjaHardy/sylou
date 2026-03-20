import { useEffect, useState, useCallback, useRef } from "react";
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
import { AISelectionButton } from "@/components/AISelectionButton";
import { TextSelectionWindow } from "@/components/TextSelectionWindow";
import { Loader2, Activity } from "lucide-react";

interface Props {
  projectId: string;
  tutorMode?: boolean;
  threadId: string | null;
  onWritingActivity?: () => void;
  onFlowClick?: () => void;
  onReanalyzeClick?: () => void;
  flowLoading?: boolean;
  hasFlowReport?: boolean;
  onAskComplete?: () => void;
}

export function WritingEditor({ projectId, tutorMode = false, threadId, onWritingActivity, onFlowClick, onReanalyzeClick, flowLoading, hasFlowReport, onAskComplete }: Props) {
  const { content, loading, saveState, updateContent, isDirty, manualSave } = useWritingContent(projectId);
  const [initialSet, setInitialSet] = useState(false);
  const editorWrapperRef = useRef<HTMLDivElement>(null);

  // AI selection state
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiAnchorRect, setAiAnchorRect] = useState<DOMRect | null>(null);
  const [aiSelectedText, setAiSelectedText] = useState("");

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
      onWritingActivity?.();
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
    setAiPanelOpen(false);
  }, [projectId]);

  const handleOpenAIPanel = useCallback((rect: DOMRect, text: string) => {
    setAiAnchorRect(rect);
    setAiSelectedText(text);
    setAiPanelOpen(true);
  }, []);

  const handleAcceptProposal = useCallback(
    (replacementText: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(replacementText).run();
    },
    [editor]
  );

  const handleAskComplete = useCallback(() => {
    onAskComplete?.();
  }, [onAskComplete]);

  if (loading || !editor) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const words = editor.storage.characterCount.words();
  const chars = editor.storage.characterCount.characters();

  const editorDom = editorWrapperRef.current;

  return (
    <div className="flex flex-col h-full">
      <EditorToolbar editor={editor} />
      <div ref={editorWrapperRef} className="flex-1 overflow-y-auto bg-background relative">
        <EditorContent editor={editor} className="h-full" />

        {/* Floating AI button on text selection */}
        {!aiPanelOpen && (
          <AISelectionButton
            editorElement={editorDom}
            onOpen={handleOpenAIPanel}
          />
        )}

        {/* AI Text Selection Window */}
        {aiPanelOpen && aiAnchorRect && editorDom && (
          <TextSelectionWindow
            selectedText={aiSelectedText}
            anchorRect={aiAnchorRect}
            editorElement={editorDom}
            tutorMode={tutorMode}
            projectId={projectId}
            threadId={threadId}
            onClose={() => setAiPanelOpen(false)}
            onAccept={handleAcceptProposal}
            onAskComplete={handleAskComplete}
          />
        )}
      </div>
      <div className="border-t border-border flex items-center justify-between px-4 py-1.5 text-xs text-muted-foreground shrink-0 bg-[hsl(var(--ethos-surface))]">
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
              className="px-4 py-1 rounded text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Save
            </button>
          ) : (
            <span className="px-2.5 py-0.5 rounded text-xs font-medium text-muted-foreground/60">
              Saved
            </span>
          )}
          {hasFlowReport && (
            <button
              onClick={onReanalyzeClick}
              disabled={flowLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium text-muted-foreground hover:text-foreground border border-border hover:border-foreground/30 transition-colors disabled:opacity-70"
            >
              Re-analyze
            </button>
          )}
          <button
            onClick={onFlowClick}
            disabled={flowLoading}
            className="inline-flex items-center gap-1.5 px-4 py-1 rounded text-sm font-medium text-white transition-colors disabled:opacity-70"
            style={{ backgroundColor: flowLoading ? '#6c757d' : '#6A8C8C' }}
          >
            {flowLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
            {flowLoading ? "Analyzing…" : hasFlowReport ? "View FLOW" : "Analyze with FLOW"}
          </button>
        </div>
      </div>
    </div>
  );
}
