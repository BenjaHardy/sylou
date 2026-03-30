import { useEffect, useState, useCallback, useRef } from "react";
import type { ChatMessage } from "@/hooks/useChatMessages";
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
import { useProvenanceTracker } from "@/hooks/useProvenanceTracker";
import { EditorToolbar } from "@/components/EditorToolbar";
import { AISelectionButton } from "@/components/AISelectionButton";
import { TextSelectionWindow } from "@/components/TextSelectionWindow";
import { Loader2, Activity } from "lucide-react";
import type { ProvenanceTracker } from "@/lib/provenance-tracker";

interface Props {
  projectId: string;
  tutorMode?: boolean;
  threadId: string | null;
  onWritingActivity?: () => void;
  onFlowClick?: () => void;
  onReanalyzeClick?: () => void;
  flowLoading?: boolean;
  hasFlowReport?: boolean;
  onAskComplete?: (messages: ChatMessage[]) => void;
  onChatRefresh?: () => void;
  onProvenanceTracker?: (tracker: ProvenanceTracker) => void;
  onFlushProvenance?: (flush: () => Promise<void>) => void;
  conciseMode?: boolean;
}

export function WritingEditor({ projectId, tutorMode = false, threadId, onWritingActivity, onFlowClick, onReanalyzeClick, flowLoading, hasFlowReport, onAskComplete, onChatRefresh, onProvenanceTracker, onFlushProvenance, conciseMode, onEditorContent }: Props & { onEditorContent?: (html: string) => void }) {
  const { content, loading, saveState, updateContent, isDirty, manualSave, flushSave: flushWritingContent } = useWritingContent(projectId);
  const { getTracker, initWithContentLength, scheduleSave, flushSave: flushProvenance, provenanceLoaded } = useProvenanceTracker(projectId);
  const [initialSet, setInitialSet] = useState(false);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const prevDocLenRef = useRef<number>(0);
  const isInitialLoadRef = useRef(false);

  // AI selection state
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiAnchorRect, setAiAnchorRect] = useState<DOMRect | null>(null);
  const [aiSelectedText, setAiSelectedText] = useState("");
  const [aiSelectionFrom, setAiSelectionFrom] = useState(0);
  const [aiSelectionTo, setAiSelectionTo] = useState(0);

  // Refs to always hold the latest flush functions (avoids stale closures)
  const flushWritingRef = useRef(flushWritingContent);
  const flushProvenanceRef = useRef(flushProvenance);
  useEffect(() => { flushWritingRef.current = flushWritingContent; }, [flushWritingContent]);
  useEffect(() => { flushProvenanceRef.current = flushProvenance; }, [flushProvenance]);

  // Expose a stable flush callback to the parent that always calls the latest versions
  useEffect(() => {
    const stableFlush = async () => {
      await flushWritingRef.current();
      await flushProvenanceRef.current();
    };
    onFlushProvenance?.(stableFlush);
  }, [onFlushProvenance]);

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
      handleDOMEvents: {
        copy: (_view, event) => {
          const ed = editor;
          if (!ed) return false;
          const { from, to } = ed.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed.state.doc.textBetween(from, to, "\n");
          if (text) {
            const dominant = tracker.getDominantSource(from, to);
            tracker.setInternalClipboard(text, dominant);
          }
          return false;
        },
        handleCut: (_view, event) => {
          const ed2 = editor;
          if (!ed2) return false;
          const { from, to } = ed2.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed2.state.doc.textBetween(from, to, "\n");
          if (text) {
            const dominant = tracker.getDominantSource(from, to);
            tracker.setInternalClipboard(text, dominant);
          }
          return false;
        },
        drop: (_view, event) => {
          // Capture the drag source's dominant provenance before the drop transaction fires
          const ed = editor;
          if (!ed) return false;
          const { from, to } = ed.state.selection;
          if (from === to) return false; // no selection being dragged
          const tracker = getTracker();
          const dominant = tracker.getDominantSource(from, to);
          const text = ed.state.doc.textBetween(from, to, "\n");
          tracker.setDragOverride({
            source: dominant,
            originalText: dominant === "typed" || dominant === "chat_user" ? null : text,
          });
          return false; // let ProseMirror handle the actual drop
        },
      },
      handlePaste: (_view, event) => {
        const tracker = getTracker();
        const pastedText = event.clipboardData?.getData("text/plain") ?? "";
        if (pastedText) {
          const classification = tracker.classifyPaste(pastedText);
          tracker.setPasteOverride(classification);
        }
        return false;
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      const newHTML = e.getHTML();
      updateContent(newHTML);
      onEditorContent?.(newHTML);
      onWritingActivity?.();

      // Track provenance changes using mapping-based approach
      if (transaction.docChanged) {
        const tracker = getTracker();

        // Skip tracking during initial content load
        if (tracker.isSkipTracking()) {
          prevDocLenRef.current = e.state.doc.content.size;
          return;
        }

        // Detect undo/redo — ProseMirror sets "history$" meta on undo/redo transactions
        const historyMeta = transaction.getMeta("history$");
        if (historyMeta) {
          // This is an undo or redo transaction
          if (historyMeta.redo) {
            tracker.redoProvenance();
          } else {
            tracker.undoProvenance();
          }
          scheduleSave();
          prevDocLenRef.current = e.state.doc.content.size;
          return;
        }

        // Check if ProseMirror is grouping this with the previous undo entry
        // (addToHistory === false means "append to previous undo group")
        const addToHistory = transaction.getMeta("addToHistory");
        const shouldPushHistory = addToHistory !== false;

        tracker.applyTransaction(
          {
            mapping: transaction.mapping,
            doc: e.state.doc,
          },
          shouldPushHistory,
        );
        scheduleSave();
      }

      prevDocLenRef.current = e.state.doc.content.size;
    },
  });

  // Set initial content when loaded
  useEffect(() => {
    if (editor && !loading && provenanceLoaded && !initialSet) {
      // Skip provenance tracking during initial setContent
      const tracker = getTracker();
      isInitialLoadRef.current = true;
      tracker.setSkipTracking(true);

      editor.commands.setContent(content || "");

      tracker.setSkipTracking(false);
      isInitialLoadRef.current = false;

      const docLen = editor.state.doc.content.size;
      prevDocLenRef.current = docLen;
      initWithContentLength(docLen);
      setInitialSet(true);
      // Expose tracker to parent (flush is handled by the stable ref-based effect above)
      onProvenanceTracker?.(tracker);
    }
  }, [editor, loading, provenanceLoaded, content, initialSet, initWithContentLength, getTracker, onProvenanceTracker]);

  // Reset when projectId changes
  useEffect(() => {
    setInitialSet(false);
    setAiPanelOpen(false);
  }, [projectId]);

  const handleOpenAIPanel = useCallback((rect: DOMRect, text: string) => {
    setAiAnchorRect(rect);
    setAiSelectedText(text);
    if (editor) {
      const { from, to } = editor.state.selection;
      setAiSelectionFrom(from);
      setAiSelectionTo(to);
    }
    setAiPanelOpen(true);
  }, [editor]);

  const handleAcceptProposal = useCallback(
    (replacementText: string) => {
      if (!editor) return;
      const tracker = getTracker();
      tracker.setPendingAiInsertion();
      editor.chain().focus().insertContent(replacementText).run();
    },
    [editor, getTracker]
  );

  const handleAskComplete = useCallback((messages: ChatMessage[]) => {
    onAskComplete?.(messages);
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
            onChatRefresh={onChatRefresh}
            provenanceTracker={getTracker()}
            conciseMode={conciseMode}
            selectionFrom={aiSelectionFrom}
            selectionTo={aiSelectionTo}
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
