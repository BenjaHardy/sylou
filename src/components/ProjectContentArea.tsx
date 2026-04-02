import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type { ChatMessage } from "@/hooks/useChatMessages";
import { FolderOpen, Lightbulb, ChevronLeft, ChevronRight, Loader2, Eye, RefreshCw, StickyNote, FileText } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { WritingEditor } from "@/components/WritingEditor";
import { ChatPanel } from "@/components/ChatPanel";
import { ProjectActivityBar } from "@/components/ProjectActivityBar";
import { FlowReportView } from "@/components/FlowReportView";
import { FlowHighlightedText } from "@/components/FlowHighlightedText";
import { FlowConfirmDialog } from "@/components/FlowConfirmDialog";
import { FlowTokenWarningDialog } from "@/components/FlowTokenWarningDialog";
import { FlowReanalyzeDialog } from "@/components/FlowReanalyzeDialog";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { usePostIts } from "@/hooks/usePostIts";
import { useImportedDocuments } from "@/hooks/useImportedDocuments";
import { PostItsPanel } from "@/components/PostItsPanel";
import { ImportedDocumentsPanel } from "@/components/ImportedDocumentsPanel";
import { useFlowAnalysis } from "@/hooks/useFlowAnalysis";
import type { Project } from "@/hooks/useProjects";
import type { ImperativePanelHandle } from "react-resizable-panels";
import type { ProvenanceTracker } from "@/lib/provenance-tracker";

interface Props {
  project: Project | null;
  onFlowLoadingChange?: (loading: boolean) => void;
  onFlushRef?: (flush: (() => Promise<void>) | null) => void;
}

function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center space-y-6 max-w-md px-4">
        <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto" />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Welcome to Ethos</h1>
          <p className="text-sm text-muted-foreground">Select a project from the sidebar or create a new one to get started.</p>
        </div>
        <div className="text-left space-y-3 bg-muted/50 rounded-md p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5" />
            Quick-start tips
          </p>
          <ul className="text-sm text-muted-foreground space-y-2">
            <li>• Click <span className="font-medium text-foreground">+ New Project</span> to create your first project</li>
            <li>• Enable <span className="font-medium text-foreground">Tutor Mode</span> for guided learning</li>
            <li>• Choose the template that fits your type of work</li>
            <li>• Use the AI chat panel to brainstorm and refine ideas</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_EDITOR_SIZE = 70;
const DEFAULT_CHAT_SIZE = 30;

export function ProjectContentArea({ project, onFlowLoadingChange, onFlushRef }: Props) {
  const [chatExpanded, setChatExpanded] = useState(false);
  const [conciseMode, setConciseMode] = useState(false);
  const [showFlowReport, setShowFlowReport] = useState(false);
  const [showPostIts, setShowPostIts] = useState(false);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showTokenWarning, setShowTokenWarning] = useState(false);
  const [showReanalyze, setShowReanalyze] = useState(false);
  const [isCurrentRunFirst, setIsCurrentRunFirst] = useState(false);
  const [chatRefreshTrigger, setChatRefreshTrigger] = useState(0);
  const [pendingChatMessages, setPendingChatMessages] = useState<ChatMessage[]>([]);
  const [provenanceTracker, setProvenanceTracker] = useState<ProvenanceTracker | null>(null);
  const [showLiveProvenance, setShowLiveProvenance] = useState(false);
  const [editorHtml, setEditorHtml] = useState("");
  const chatSetMessagesRef = useRef<((updater: (prev: ChatMessage[]) => ChatMessage[]) => void) | null>(null);
  const [provenanceKey, setProvenanceKey] = useState(0);
  const flushProvenanceRef = useRef<(() => Promise<void>) | null>(null);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const { markWriting } = useActivityTracker(project?.id ?? null);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const { postIts, loading: postItsLoading, createPostIt, updatePostIt, updatePosition, deletePostIt } = usePostIts(project?.id ?? null);
  const { documents, loading: docsLoading, uploading: docsUploading, uploadDocument, deleteDocument } = useImportedDocuments(project?.id ?? null);

  const {
    preCheck,
    runPreCheck,
    clearPreCheck,
    loading: flowLoading,
    report: flowReport,
    error: flowError,
    budgetError,
    runAnalysis,
    saveFeedback,
    saveUserAssessment,
    isFirstAnalysis,
  } = useFlowAnalysis(project?.id ?? null);

  useEffect(() => {
    onFlowLoadingChange?.(flowLoading);
  }, [flowLoading, onFlowLoadingChange]);

  // Flush chain: Index.handleSelectProject → awaits flushRef.current()
  //   → ProjectContentArea.flush → WritingEditor.stableFlush
  //     → flushWritingContent (saves editor HTML to DB)
  //     → flushProvenance (saves segment_map to DB)
  // This ensures both content and provenance are persisted before switching projects.
  useEffect(() => {
    if (!project) {
      onFlushRef?.(null);
      return;
    }
    const flush = async () => {
      await flushProvenanceRef.current?.();
    };
    onFlushRef?.(flush);
    return () => onFlushRef?.(null);
  }, [project, onFlushRef]);

  // Keyboard shortcut: Ctrl/Cmd + Shift + N → toggle Post-its
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        setShowPostIts((v) => !v);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const isMac = useMemo(() => typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform), []);
  const postItsShortcutLabel = isMac ? "⌘⇧N" : "Ctrl+Shift+N";

  if (!project) return <WelcomeScreen />;

  const handleToggleChat = () => {
    if (chatExpanded) {
      editorPanelRef.current?.resize(DEFAULT_EDITOR_SIZE);
      chatPanelRef.current?.resize(DEFAULT_CHAT_SIZE);
      setChatExpanded(false);
    } else {
      editorPanelRef.current?.resize(0);
      chatPanelRef.current?.resize(100);
      setChatExpanded(true);
    }
  };

  const handleCloseFlowReport = () => {
    setShowFlowReport(false);
    setIsCurrentRunFirst(false);
  };

  const handleFlowClick = () => {
    if (flowReport && !flowLoading) {
      setIsCurrentRunFirst(false);
      setShowFlowReport(true);
      return;
    }
    setShowConfirm(true);
  };

  const handleReanalyzeClick = () => {
    setShowReanalyze(true);
  };

  const handleConfirmAnalysis = async () => {
    setShowConfirm(false);
    setIsCurrentRunFirst(isFirstAnalysis);
    const estimation = await runPreCheck();
    if (!estimation) return;

    if (estimation.status === "ok") {
      setShowFlowReport(true);
      await flushProvenanceRef.current?.();
      runAnalysis();
    } else {
      setShowTokenWarning(true);
    }
  };

  const handleConfirmReanalyze = async () => {
    setShowReanalyze(false);
    setIsCurrentRunFirst(false);
    const estimation = await runPreCheck();
    if (!estimation) return;

    if (estimation.status === "ok") {
      setShowFlowReport(true);
      await flushProvenanceRef.current?.();
      runAnalysis();
    } else {
      setShowTokenWarning(true);
    }
  };

  const handleTokenWarningConfirm = async () => {
    setShowTokenWarning(false);
    clearPreCheck();
    setShowFlowReport(true);
    await flushProvenanceRef.current?.();
    runAnalysis();
  };

  const handleTokenWarningCancel = () => {
    setShowTokenWarning(false);
    clearPreCheck();
  };

  const showingFlowReport = showFlowReport && (flowReport || flowLoading);
  const showingPostIts = showPostIts && !showingFlowReport;
  const showingDocuments = showDocuments && !showingFlowReport && !showingPostIts;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* FLOW report layer — rendered on top when active */}
      {showingFlowReport && (
        flowLoading && !flowReport ? (
          <div className="flex-1 flex items-center justify-center bg-background h-screen">
            <div className="text-center space-y-4">
              <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
              <div>
                <p className="text-sm font-medium text-foreground">Analyzing your project…</p>
                <p className="text-xs text-muted-foreground mt-1">This may take up to a minute</p>
              </div>
            </div>
          </div>
        ) : flowLoading ? (
          <div className="flex-1 flex flex-col bg-background h-screen">
            <FlowReportView
              report={flowReport!}
              projectName={project.name}
              loading={true}
              onBack={handleCloseFlowReport}
              onSaveFeedback={() => {}}
              onSaveAssessment={() => {}}
              showPreAnalysis={false}
            />
          </div>
        ) : flowReport ? (
          <>
            <FlowReportView
              report={flowReport}
              projectName={project.name}
              loading={false}
              onBack={handleCloseFlowReport}
              onSaveFeedback={saveFeedback}
              onSaveAssessment={saveUserAssessment}
              showPreAnalysis={isCurrentRunFirst}
            />
            <FlowTokenWarningDialog
              open={showTokenWarning}
              estimation={preCheck}
              onConfirm={async () => {
                setShowTokenWarning(false);
                clearPreCheck();
                await flushProvenanceRef.current?.();
                runAnalysis();
              }}
              onCancel={() => {
                setShowTokenWarning(false);
                clearPreCheck();
              }}
            />
          </>
        ) : null
      )}

      {/* Post-its layer — rendered on top when active, hides editor via CSS */}
      {showingPostIts && (
        <PostItsPanel
          postIts={postIts}
          loading={postItsLoading}
          onCreate={createPostIt}
          onUpdate={updatePostIt}
          onUpdatePosition={updatePosition}
          onDelete={deletePostIt}
          onClose={() => setShowPostIts(false)}
        />
      )}

      {/* Editor layer — always mounted, hidden via CSS when FLOW report or Post-its are showing */}
      <div
        className="flex-1 flex flex-col bg-background h-screen [&_[data-panel]]:transition-all [&_[data-panel]]:duration-150 [&_[data-panel]]:ease-ethos-ease"
        style={{ display: showingFlowReport || showingPostIts ? 'none' : undefined }}
      >
        <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-[hsl(var(--ethos-surface))]">
          <span className="text-sm font-medium text-foreground truncate max-w-[200px]">{project.name}</span>
          <div className="flex items-center gap-2">
            {flowError && (
              <span className="text-xs text-destructive truncate max-w-[200px]">{flowError}</span>
            )}
            {budgetError && (
              <span className="text-xs text-destructive truncate max-w-[260px]">
                Budget: ~{budgetError.estimated_cost.toLocaleString()} needed, {budgetError.budget_remaining.toLocaleString()} remaining
              </span>
            )}
            <Button
              variant={showLiveProvenance ? "secondary" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => {
                if (!showLiveProvenance) setProvenanceKey((k) => k + 1);
                setShowLiveProvenance((v) => !v);
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              Provenance
            </Button>
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={showPostIts ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => setShowPostIts((v) => !v)}
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                    Post-its
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <span>Toggle Post-its ({postItsShortcutLabel})</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel ref={editorPanelRef} defaultSize={DEFAULT_EDITOR_SIZE} minSize={0}>
            <div className="flex flex-col h-full">
              <WritingEditor
                projectId={project.id}
                tutorMode={project.tutor_mode}
                threadId={activeThreadId}
                onWritingActivity={markWriting}
                onFlowClick={handleFlowClick}
                onReanalyzeClick={handleReanalyzeClick}
                flowLoading={flowLoading}
                hasFlowReport={!!flowReport}
                onAskComplete={(msgs) => setPendingChatMessages((prev) => [...prev, ...msgs])}
                onChatRefresh={() => setChatRefreshTrigger((n) => n + 1)}
                onProvenanceTracker={setProvenanceTracker}
                onFlushProvenance={(fn) => { flushProvenanceRef.current = fn; }}
                conciseMode={conciseMode}
                onEditorContent={setEditorHtml}
                chatSetMessages={chatSetMessagesRef.current ?? undefined}
              />
              {showLiveProvenance && provenanceTracker && (
                <div className="border-t border-border h-[40%] min-h-[200px] overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-1 bg-[hsl(var(--ethos-surface))] border-b border-border">
                    <span className="text-xs font-medium text-muted-foreground">Live Provenance View</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 text-xs"
                      onClick={() => setProvenanceKey((k) => k + 1)}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Refresh
                    </Button>
                  </div>
                  <FlowHighlightedText
                    key={provenanceKey}
                    segments={provenanceTracker.getSegments()}
                    writingContent={editorHtml}
                    onClose={() => setShowLiveProvenance(false)}
                  />
                </div>
              )}
              <div className="h-7 border-t border-border flex items-center px-4 shrink-0 bg-[hsl(var(--ethos-surface))]">
                <ProjectActivityBar projectId={project.id} />
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel ref={chatPanelRef} defaultSize={DEFAULT_CHAT_SIZE} minSize={20}>
            <ChatPanel projectId={project.id} chatExpanded={chatExpanded} onToggleChat={handleToggleChat} refreshTrigger={chatRefreshTrigger} injectMessages={pendingChatMessages} onMessagesInjected={() => setPendingChatMessages([])} provenanceTracker={provenanceTracker ?? undefined} conciseMode={conciseMode} onConciseModeChange={setConciseMode} onSetMessages={(setter) => { chatSetMessagesRef.current = setter; }} onActiveThreadChange={setActiveThreadId} />
          </ResizablePanel>
        </ResizablePanelGroup>

        <FlowConfirmDialog open={showConfirm} onConfirm={handleConfirmAnalysis} onCancel={() => setShowConfirm(false)} />
        <FlowReanalyzeDialog open={showReanalyze} onConfirm={handleConfirmReanalyze} onCancel={() => setShowReanalyze(false)} />
        <FlowTokenWarningDialog open={showTokenWarning} estimation={preCheck} onConfirm={handleTokenWarningConfirm} onCancel={handleTokenWarningCancel} />
      </div>
    </div>
  );
}
