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
import { Pagination } from "@/lib/editor-extensions/pagination";
import { useWritingContent } from "@/hooks/useWritingContent";
import { useProvenanceTracker } from "@/hooks/useProvenanceTracker";
import { EditorToolbar } from "@/components/EditorToolbar";
import { AISelectionButton } from "@/components/AISelectionButton";
import { TextSelectionWindow } from "@/components/TextSelectionWindow";
import { Loader2, Activity } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { exportWritingAsDocx } from "@/lib/export-docx";
import { exportProjectAsJson } from "@/lib/export-json";
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
  chatSetMessages?: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  webSearchEnabled?: boolean;
}

export function WritingEditor({ projectId, tutorMode = false, threadId, onWritingActivity, onFlowClick, onReanalyzeClick, flowLoading, hasFlowReport, onAskComplete, onChatRefresh, onProvenanceTracker, onFlushProvenance, conciseMode, onEditorContent, chatSetMessages, webSearchEnabled }: Props & { onEditorContent?: (html: string) => void }) {
  const { user } = useAuth();
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

  // Page view (session-only)
  const [pageView, setPageView] = useState(false);

  // Flush refs: useWritingContent and useProvenanceTracker return new flushSave
  // callbacks when projectId changes (they close over the new project). Storing
  // them in refs lets us expose a single stable flush callback to the parent
  // without stale closure bugs — the parent always calls the latest versions.
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
      Pagination,
    ],
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose max-w-none focus:outline-none min-h-full px-8 py-6",
        style: "font-size:16px;line-height:1.6;",
      },
      // NOTE: keys in `handleDOMEvents` must be raw DOM event names
      // (`copy`, `cut`, `drop`, `dragstart`, `dragend`, ...). TipTap does
      // NOT validate them — a misnamed key (e.g. `handleCut`) is silently
      // never invoked. Double-check names when adding handlers here.
      handleDOMEvents: {
        copy: (_view, event) => {
          const ed = editor;
          if (!ed) return false;
          const { from, to } = ed.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed.state.doc.textBetween(from, to, "\n");
          if (text) {
            tracker.setInternalClipboardSlice(tracker.getSegmentSlice(from, to, text));
          }
          return false;
        },
        cut: (_view, event) => {
          const ed2 = editor;
          if (!ed2) return false;
          const { from, to } = ed2.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed2.state.doc.textBetween(from, to, "\n");
          if (text) {
            tracker.setInternalClipboardSlice(tracker.getSegmentSlice(from, to, text));
          }
          return false;
        },
        // Drag & drop: capture the per-segment slice at `dragstart` (when
        // selection still reflects the drag source). At `drop` the selection
        // has typically moved to the drop target, so reading it there would
        // miss or mis-size the slice and degrade to the dominant source.
        dragstart: (_view, event) => {
          const ed = editor;
          if (!ed) return false;
          const { from, to } = ed.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed.state.doc.textBetween(from, to, "\n");
          const slice = tracker.getSegmentSlice(from, to, text);
          tracker.setPendingSignal({
            kind: "slice",
            segments: slice.segments,
            totalLength: slice.totalLength,
          });
          console.debug("[provenance] dragstart: slice signal set", {
            totalLength: slice.totalLength,
            segments: slice.segments.length,
          });
          return false;
        },
        drop: (_view, event) => {
          const tracker = getTracker();
          // Tracker state is the single source of truth: if a slice signal
          // is already pending (set by our dragstart), this is an internal
          // drag — let it flow through. Otherwise treat as external.
          if (tracker.hasPendingSliceSignal()) {
            console.debug("[provenance] drop: internal (slice signal present)");
            return false;
          }
          const dt = event.dataTransfer;
          const droppedText = dt ? dt.getData("text/plain") : "";
          if (droppedText) {
            tracker.setPendingSignal({
              source: "external",
              originalText: droppedText,
            });
            console.debug("[provenance] drop: external", { length: droppedText.length });
          } else {
            // No usable plaintext on the dataTransfer — fall through and let
            // the gap classify as `typed` rather than fabricate an external
            // tag from missing data.
            console.debug("[provenance] drop: no plaintext on dataTransfer, falling through");
          }
          return false;
        },
        dragend: (_view, _event) => {
          // ALWAYS clear: if the drop occurred in this editor the signal was
          // already consumed (no-op); if the user dropped outside the editor
          // no drop transaction fired and the stale slice signal would
          // otherwise corrupt the next unrelated paste/gap-fill.
          const tracker = getTracker();
          tracker.clearPendingSignal();
          console.debug("[provenance] dragend: pending signal cleared");
          return false;
        },
      },
      handlePaste: (_view, event) => {
        const tracker = getTracker();
        const pastedText = event.clipboardData?.getData("text/plain") ?? "";
        if (pastedText) {
          // Prefer per-segment replay if the paste matches the internal
          // clipboard; otherwise fall back to the single-source priority
          // chain (AI registry → chat clipboard → external).
          const slice = tracker.consumeInternalClipboardSlice(pastedText);
          if (slice) {
            tracker.setPendingSignal({
              kind: "slice",
              segments: slice.segments,
              totalLength: slice.totalLength,
            });
          } else {
            tracker.setPendingSignal(tracker.classifyPaste(pastedText));
          }
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

  // Toggle pagination plugin when page view changes
  useEffect(() => {
    if (!editor) return;
    editor.commands.setPaginationEnabled(pageView);
  }, [editor, pageView]);


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
      tracker.setPendingSignal({ source: "ai_editor", originalText: null });
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
    <div className="flex flex-col h-full min-h-0">
      {/* Subscription tier query for export gating */}
      <ExportEnabledToolbar
        editor={editor}
        userId={user?.id}
        projectId={projectId}
        pageView={pageView}
        onTogglePageView={() => setPageView((v) => !v)}
      />
      <div
        ref={editorWrapperRef}
        className={`flex-1 overflow-y-auto relative ${
          pageView ? "bg-muted" : "bg-background"
        }`}
      >
        {pageView ? (
          <div className="flex justify-center py-8 print:py-0">
            <div className="editor-page-sheet">
              <EditorContent editor={editor} />
            </div>
          </div>
        ) : (
          <EditorContent editor={editor} className="h-full" />
        )}

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
            setMessages={chatSetMessages}
            webSearchEnabled={webSearchEnabled}
          />
        )}
      </div>
      <div className="border-t border-border flex items-center justify-between px-4 py-1.5 text-xs text-muted-foreground shrink-0 bg-[hsl(var(--ethos-surface))] print:hidden">
        <span>
          {words} {words === 1 ? "word" : "words"} · {chars}{" "}
          {chars === 1 ? "character" : "characters"}
        </span>
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground/60">
            Sylou™ ·{" "}
            <a
              href="https://www.gnu.org/licenses/agpl-3.0.html"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              AGPL-3.0
            </a>
          </span>
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

function ExportEnabledToolbar({
  editor,
  userId,
  projectId,
  pageView,
  onTogglePageView,
}: {
  editor: any;
  userId?: string;
  projectId: string;
  pageView?: boolean;
  onTogglePageView?: () => void;
}) {
  const [tier, setTier] = useState("free");
  const [projectName, setProjectName] = useState("document");

  useEffect(() => {
    if (!userId) return;
    supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("id", userId)
      .single()
      .then(({ data }) => {
        if (data?.subscription_tier) setTier(data.subscription_tier);
      });
  }, [userId]);

  useEffect(() => {
    supabase
      .from("projects")
      .select("name")
      .eq("id", projectId)
      .single()
      .then(({ data }) => {
        if (data?.name) setProjectName(data.name);
      });
  }, [projectId]);

  const handleExportPDF = useCallback(() => {
    window.print();
  }, []);

  const handleExportDOCX = useCallback(async () => {
    if (tier === "free") {
      toast.error("Upgrade to Starter or above to export as DOCX");
      return;
    }
    try {
      const html = editor.getHTML();
      await exportWritingAsDocx(html, projectName);
      toast.success("DOCX exported successfully");
    } catch (e) {
      console.error("DOCX export failed:", e);
      toast.error("Failed to export DOCX");
    }
  }, [editor, tier, projectName]);

  const handleExportJSON = useCallback(async () => {
    if (tier === "free") {
      toast.error("Upgrade to Starter or above to export project as JSON");
      return;
    }
    try {
      await exportProjectAsJson(projectId);
      toast.success("Project JSON exported successfully");
    } catch (e) {
      console.error("JSON export failed:", e);
      toast.error("Failed to export project JSON");
    }
  }, [tier, projectId]);

  return (
    <EditorToolbar
      editor={editor}
      onExportPDF={handleExportPDF}
      onExportDOCX={handleExportDOCX}
      onExportJSON={handleExportJSON}
      subscriptionTier={tier}
      pageView={pageView}
      onTogglePageView={onTogglePageView}
    />
  );
}
