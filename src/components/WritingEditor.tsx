import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import type { ChatMessage } from "@/hooks/useChatMessages";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
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

import { exportWritingAsDocx } from "@/lib/export-docx";
import { exportProjectAsJson } from "@/lib/export-json";
import type { ProvenanceTracker } from "@/lib/provenance-tracker";
import { buildEditorMarkdownParser, parseMarkdownToFragment } from "@/lib/markdown-to-pm";

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
  /** Registers the combined writing+provenance flush; resolves false when a write failed. */
  onFlushEditor?: (flush: () => Promise<boolean>) => void;
  conciseMode?: boolean;
  chatSetMessages?: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void;
  webSearchEnabled?: boolean;
}

export function WritingEditor({ projectId, tutorMode = false, threadId, onWritingActivity, onFlowClick, onReanalyzeClick, flowLoading, hasFlowReport, onAskComplete, onChatRefresh, onProvenanceTracker, onFlushEditor, conciseMode, onEditorContent, chatSetMessages, webSearchEnabled }: Props & { onEditorContent?: (html: string) => void }) {
  
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
      const writingOk = await flushWritingRef.current();
      const provenanceOk = await flushProvenanceRef.current();
      return writingOk && provenanceOk;
    };
    onFlushEditor?.(stableFlush);
  }, [onFlushEditor]);

  // Keep a ref of isDirty so the unload handler reads it without re-registering
  // listeners on every keystroke.
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  // Best-effort flush + unsaved-changes guard before the page goes away. Saves
  // are debounced (see useWritingContent), so a hard tab close / refresh within
  // that window could otherwise drop the tail of unsaved edits. Flush on
  // tab-hide and on unload; when there are genuinely unsaved changes, also trip
  // the browser's native prompt — async saves aren't guaranteed to finish during
  // unload, so the prompt buys time for the flush and warns the user.
  useEffect(() => {
    const flushNow = () => {
      void flushWritingRef.current();
      void flushProvenanceRef.current();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      flushNow();
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, []);

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
        copy: (_view, _event) => {
          const ed = editor;
          if (!ed) return false;
          const { from, to } = ed.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed.state.doc.textBetween(from, to, "\n", "\n"); // leafText "\n": count hard breaks like the clipboard serializer does
          if (text) {
            tracker.setInternalClipboardSlice(tracker.getSegmentSlice(from, to, text));
          }
          return false;
        },
        cut: (_view, _event) => {
          const ed2 = editor;
          if (!ed2) return false;
          const { from, to } = ed2.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed2.state.doc.textBetween(from, to, "\n", "\n"); // leafText "\n": count hard breaks like the clipboard serializer does
          if (text) {
            tracker.setInternalClipboardSlice(tracker.getSegmentSlice(from, to, text));
          }
          return false;
        },
        // Drag & drop: capture the per-segment slice at `dragstart` (when
        // selection still reflects the drag source). At `drop` the selection
        // has typically moved to the drop target, so reading it there would
        // miss or mis-size the slice and degrade to the dominant source.
        dragstart: (_view, _event) => {
          const ed = editor;
          if (!ed) return false;
          const { from, to } = ed.state.selection;
          if (from === to) return false;
          const tracker = getTracker();
          const text = ed.state.doc.textBetween(from, to, "\n", "\n"); // leafText "\n": count hard breaks like the clipboard serializer does
          const slice = tracker.getSegmentSlice(from, to, text);
          tracker.setPendingSignal({
            kind: "slice",
            segments: slice.segments,
            totalLength: slice.totalLength,
          });
          return false;
        },
        drop: (_view, event) => {
          const tracker = getTracker();
          // Tracker state is the single source of truth: if a slice signal
          // is already pending (set by our dragstart), this is an internal
          // drag — let it flow through. Otherwise treat as external.
          if (tracker.hasPendingSliceSignal()) {
            return false;
          }
          const dt = event.dataTransfer;
          const droppedText = dt ? dt.getData("text/plain") : "";
          if (droppedText) {
            tracker.setPendingSignal({
              source: "external",
            });
          }
          // No usable plaintext on the dataTransfer — fall through and let
          // the gap classify as `typed` rather than fabricate an external
          // tag from missing data.
          return false;
        },
        dragend: (_view, _event) => {
          // ALWAYS clear: if the drop occurred in this editor the signal was
          // already consumed (no-op); if the user dropped outside the editor
          // no drop transaction fired and the stale slice signal would
          // otherwise corrupt the next unrelated paste/gap-fill.
          const tracker = getTracker();
          tracker.clearPendingSignal();
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
      // Push the loaded HTML up: setContent does not fire onUpdate, so the
      // parent's editorHtml (and the Live Provenance View reading it) would
      // otherwise keep the previous project's text until the first
      // keystroke. Direct call rather than setContent's emitUpdate flag —
      // emitting would also trigger updateContent (a pointless re-save of
      // just-loaded content) and the writing-activity ping.
      onEditorContent?.(editor.getHTML());
      // Expose tracker to parent (flush is handled by the stable ref-based effect above)
      onProvenanceTracker?.(tracker);
    }
  }, [editor, loading, provenanceLoaded, content, initialSet, initWithContentLength, getTracker, onProvenanceTracker, onEditorContent]);

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

  // Markdown parser bound to the editor's actual schema (StarterKit + extensions).
  // Rebuilt only when the editor instance changes (effectively once per mount).
  const markdownParser = useMemo(
    () => (editor ? buildEditorMarkdownParser(editor.schema) : null),
    [editor],
  );

  const isInsertingRef = useRef(false);

  const handleAcceptProposal = useCallback(
    (replacementText: string) => {
      if (!editor) return;
      if (isInsertingRef.current) return;
      isInsertingRef.current = true;
      try {
        const tracker = getTracker();
        tracker.setPendingSignal({ source: "ai_editor" });

        // Parse markdown → ProseMirror JSON fragment so headings, lists, bold,
        // etc. become real nodes/marks instead of literal characters inside
        // <p> nodes (which previously broke Claude's FLOW schema parsing).
        const fragment = markdownParser
          ? parseMarkdownToFragment(markdownParser, replacementText)
          : null;

        try {
          if (fragment) {
            editor.chain().focus().insertContent(fragment).run();
          } else {
            editor.chain().focus().insertContent(replacementText).run();
          }
        } catch (err) {
          console.warn(
            "Editor rejected parsed AI fragment (likely an unsupported node type from prosemirror-markdown). " +
              "Falling back to raw text insertion. The inserted content may contain literal markdown characters " +
              "that could affect FLOW analysis with Claude.",
            err,
          );
          editor.chain().focus().insertContent(replacementText).run();
        }
      } finally {
        isInsertingRef.current = false;
      }
    },
    [editor, getTracker, markdownParser]
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
      <ExportEnabledToolbar
        editor={editor}
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
          <span className={saveState.status === "error" ? "text-destructive" : undefined}>
            {saveState.status === "saving" && "Saving…"}
            {saveState.status === "saved" && !isDirty && "✓ Saved"}
            {saveState.status === "error" && "⚠ Save failed"}
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
  projectId,
  pageView,
  onTogglePageView,
}: {
  editor: Editor;
  projectId: string;
  pageView?: boolean;
  onTogglePageView?: () => void;
}) {
  const [projectName, setProjectName] = useState("document");

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
    // Render the editor HTML into a print-only container appended to <body>.
    // The live app is nested inside h-screen + overflow-hidden ancestors that
    // clip content to the viewport, which caused the browser to only paginate
    // page 1 when printing directly. The print CSS hides everything else and
    // reveals this container so all pages flow naturally.
    const html = editor.getHTML();

    const container = document.createElement("div");
    // .prose + .tiptap keeps typography consistent with the on-screen editor.
    container.className = "print-export-root prose tiptap";
    container.innerHTML = html;
    document.body.appendChild(container);

    // Browsers use document.title as the default PDF filename. Sanitize to
    // avoid characters (slashes, quotes, control chars) that can cause the
    // browser to fall back to "Untitled.pdf".
    const safeName =
      (projectName || "document")
        .replace(/[^a-zA-Z0-9 _.-]/g, "")
        .trim()
        .slice(0, 80) || "document";
    const originalTitle = document.title;
    document.title = safeName;

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      container.remove();
      document.title = originalTitle;
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // Fallback: some browsers (notably Safari) don't reliably fire afterprint.
    // 30s is well beyond a print dialog interaction but ensures we don't leak.
    setTimeout(cleanup, 30_000);

    window.print();
  }, [editor, projectName]);


  const handleExportDOCX = useCallback(async () => {
    try {
      const html = editor.getHTML();
      await exportWritingAsDocx(html, projectName);
      toast.success("DOCX exported successfully");
    } catch (e) {
      console.error("DOCX export failed:", e);
      toast.error("Failed to export DOCX");
    }
  }, [editor, projectName]);

  const handleExportJSON = useCallback(async () => {
    try {
      await exportProjectAsJson(projectId);
      toast.success("Project JSON exported successfully");
    } catch (e) {
      console.error("JSON export failed:", e);
      toast.error("Failed to export project JSON");
    }
  }, [projectId]);

  return (
    <EditorToolbar
      editor={editor}
      onExportPDF={handleExportPDF}
      onExportDOCX={handleExportDOCX}
      onExportJSON={handleExportJSON}
      pageView={pageView}
      onTogglePageView={onTogglePageView}
    />
  );
}

