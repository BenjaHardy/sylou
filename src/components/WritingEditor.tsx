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
  conciseMode?: boolean;
}

export function WritingEditor({ projectId, tutorMode = false, threadId, onWritingActivity, onFlowClick, onReanalyzeClick, flowLoading, hasFlowReport, onAskComplete, onChatRefresh, onProvenanceTracker, conciseMode }: Props) {
  const { content, loading, saveState, updateContent, isDirty, manualSave } = useWritingContent(projectId);
  const { getTracker, initWithContentLength, scheduleSave, provenanceLoaded } = useProvenanceTracker(projectId);
  const [initialSet, setInitialSet] = useState(false);
  const editorWrapperRef = useRef<HTMLDivElement>(null);
  const prevDocLenRef = useRef<number>(0);

  // AI selection state
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiAnchorRect, setAiAnchorRect] = useState<DOMRect | null>(null);
  const [aiSelectedText, setAiSelectedText] = useState("");
  const [aiSelectionFrom, setAiSelectionFrom] = useState(0);
  const [aiSelectionTo, setAiSelectionTo] = useState(0);

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
          if (from === to) return false; // collapsed selection — bail out
          const tracker = getTracker();
          const text = ed.state.doc.textBetween(from, to, "");
          if (text) {
            const dominant = tracker.getDominantSource(from, to);
            tracker.setInternalClipboard(text, dominant);
          }
          return false; // let default copy proceed
        },
        cut: (_view, event) => {
          const ed = editor;
          if (!ed) return false;
          const { from, to } = ed.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed.state.doc.textBetween(from, to, "");
          if (text) {
            const dominant = tracker.getDominantSource(from, to);
            tracker.setInternalClipboard(text, dominant);
          }
          return false; // let default cut proceed
        },
      },
      handlePaste: (_view, event) => {
        const tracker = getTracker();
        const pastedText = event.clipboardData?.getData("text/plain") ?? "";
        if (pastedText) {
          const classification = tracker.classifyPaste(pastedText);
          tracker.setPasteOverride(classification);
        }
        return false; // Let TipTap handle the actual paste
      },
    },
    onUpdate: ({ editor: e, transaction }) => {
      const newHTML = e.getHTML();
      updateContent(newHTML);
      onWritingActivity?.();

      // Track provenance changes
      const tracker = getTracker();
      const newLen = e.state.doc.content.size;
      const oldLen = prevDocLenRef.current;

      if (newLen !== oldLen && transaction.docChanged) {
        const normalize = (t: string) => t.trim().replace(/\s+/g, " ");
        let hasChanges = false;

        // Process each step immediately to avoid coordinate drift
        transaction.steps.forEach((step, stepIndex) => {
          const stepMap = step.getMap();
          // Get the doc state after this step (steps are applied sequentially)
          const docAfterStep = stepIndex < transaction.steps.length - 1
            ? transaction.docs[stepIndex + 1]
            : e.state.doc;
          const docBeforeStep = stepIndex === 0
            ? transaction.before
            : transaction.docs[stepIndex];

          stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
            const insertLength = newEnd - newStart;
            const deleteLength = oldEnd - oldStart;
            let insertedText = "";
            let preserveSource: false | 'within' | 'tail' = false;

            if (insertLength > 0) {
              try {
                insertedText = docAfterStep.textBetween(newStart, newEnd, "");
              } catch {
                insertedText = "";
              }
            }

            // Detect structural reorganizations (paragraph merges)
            if (deleteLength > 0 && insertLength > 0 && insertedText) {
              try {
                const normalizedNew = normalize(insertedText);
                if (normalizedNew.length > 0) {
                  const oldText = docBeforeStep.textBetween(oldStart, oldEnd, "");
                  const normalizedOld = normalize(oldText);
                  if (normalizedOld.includes(normalizedNew)) {
                    preserveSource = 'within';
                  } else {
                    const beforeSize = docBeforeStep.content.size;
                    if (oldEnd < beforeSize) {
                      const tailEnd = Math.min(beforeSize, oldEnd + insertLength + 50);
                      const tailText = docBeforeStep.textBetween(oldEnd, tailEnd, "");
                      if (normalize(tailText).includes(normalizedNew)) {
                        preserveSource = 'tail';
                      }
                    }
                  }
                }
              } catch {
                // fall through
              }
            }

            tracker.handleSingleChange({
              from: oldStart,
              to: oldEnd,
              insertLength,
              insertedText,
              preserveSource,
            });
            hasChanges = true;
          });
        });

        if (hasChanges) {
          scheduleSave();
        }
      }

      prevDocLenRef.current = newLen;
    },
  });

  // Set initial content when loaded
  useEffect(() => {
    if (editor && !loading && provenanceLoaded && !initialSet) {
      editor.commands.setContent(content || "");
      const docLen = editor.state.doc.content.size;
      prevDocLenRef.current = docLen;
      initWithContentLength(docLen);
      setInitialSet(true);
      // Expose tracker to parent
      onProvenanceTracker?.(getTracker());
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
    // Capture selection positions for provenance source breakdown
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
      // Flag the tracker for AI insertion before inserting content
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
