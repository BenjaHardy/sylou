import { useState, useRef } from "react";
import { FolderOpen, Lightbulb, ChevronLeft, ChevronRight, Activity, Loader2 } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { WritingEditor } from "@/components/WritingEditor";
import { ChatPanel } from "@/components/ChatPanel";
import { ProjectActivityBar } from "@/components/ProjectActivityBar";
import { FlowReportView } from "@/components/FlowReportView";
import { FlowConfirmDialog } from "@/components/FlowConfirmDialog";
import { FlowTokenWarningDialog } from "@/components/FlowTokenWarningDialog";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useFlowAnalysis } from "@/hooks/useFlowAnalysis";
import type { Project } from "@/hooks/useProjects";
import type { ImperativePanelHandle } from "react-resizable-panels";

interface Props {
  project: Project | null;
}

function WelcomeScreen() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center space-y-6 max-w-md px-4">
        <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto" />
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-foreground">
            Welcome to Ethos
          </h1>
          <p className="text-sm text-muted-foreground">
            Select a project from the sidebar or create a new one to get started.
          </p>
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
            <li>• Select text in your editor and use <span className="font-medium text-foreground">Ask</span> or <span className="font-medium text-foreground">Propose</span> for context-aware AI feedback</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

const DEFAULT_EDITOR_SIZE = 70;
const DEFAULT_CHAT_SIZE = 30;

export function ProjectContentArea({ project }: Props) {
  const [chatExpanded, setChatExpanded] = useState(false);
  const [showFlowReport, setShowFlowReport] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showTokenWarning, setShowTokenWarning] = useState(false);
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const { markWriting } = useActivityTracker(project?.id ?? null);

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
  } = useFlowAnalysis(project?.id ?? null);

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

  const handleFlowClick = () => {
    // If we already have a report and not loading, show it
    if (flowReport && !flowLoading) {
      setShowFlowReport(true);
      return;
    }
    setShowConfirm(true);
  };

  const handleConfirmAnalysis = async () => {
    setShowConfirm(false);
    // Run pre-check for token estimation
    const estimation = await runPreCheck();
    if (!estimation) return;

    if (estimation.status === "ok") {
      // Safe — proceed directly
      setShowFlowReport(true);
      runAnalysis();
    } else {
      // Show token warning
      setShowTokenWarning(true);
    }
  };

  const handleTokenWarningConfirm = () => {
    setShowTokenWarning(false);
    clearPreCheck();
    setShowFlowReport(true);
    runAnalysis();
  };

  const handleTokenWarningCancel = () => {
    setShowTokenWarning(false);
    clearPreCheck();
  };

  const handleRerunAnalysis = async () => {
    const estimation = await runPreCheck();
    if (!estimation) return;
    if (estimation.status === "ok") {
      runAnalysis();
    } else {
      setShowTokenWarning(true);
    }
  };

  // Show FLOW report view (full-width, replaces editor/chat)
  if (showFlowReport && (flowReport || flowLoading)) {
    if (flowLoading) {
      return (
        <div className="flex-1 flex flex-col bg-background h-screen">
          <FlowReportView
            report={flowReport!}
            projectName={project.name}
            loading={true}
            onBack={() => setShowFlowReport(false)}
            onSaveFeedback={() => {}}
          />
        </div>
      );
    }

    if (flowReport) {
      return (
        <>
          <FlowReportView
            report={flowReport}
            projectName={project.name}
            loading={false}
            onBack={() => setShowFlowReport(false)}
            onSaveFeedback={saveFeedback}
          />
          <FlowTokenWarningDialog
            open={showTokenWarning}
            estimation={preCheck}
            onConfirm={() => {
              setShowTokenWarning(false);
              clearPreCheck();
              runAnalysis();
            }}
            onCancel={() => {
              setShowTokenWarning(false);
              clearPreCheck();
            }}
          />
        </>
      );
    }
  }

  // Loading overlay (analysis running but no previous report to show)
  if (showFlowReport && flowLoading && !flowReport) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background h-screen">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Analyzing your project…
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              This may take up to a minute
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-background h-screen [&_[data-panel]]:transition-all [&_[data-panel]]:duration-150 [&_[data-panel]]:ease-ethos-ease">
      {/* Project toolbar with FLOW button */}
      <div className="h-10 border-b border-border flex items-center justify-between px-4 shrink-0 bg-[hsl(var(--ethos-surface))]">
        <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
          {project.name}
        </span>
        <div className="flex items-center gap-2">
          {flowError && (
            <span className="text-xs text-destructive truncate max-w-[200px]">
              {flowError}
            </span>
          )}
          {budgetError && (
            <span className="text-xs text-destructive truncate max-w-[260px]">
              Budget: ~{budgetError.estimated_cost.toLocaleString()} needed, {budgetError.budget_remaining.toLocaleString()} remaining
            </span>
          )}
          <Button
            size="sm"
            onClick={handleFlowClick}
            disabled={flowLoading}
            className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
          >
            {flowLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
            {flowLoading
              ? "Analyzing…"
              : flowReport
              ? "View FLOW Report"
              : "Run FLOW Analysis"}
          </Button>
        </div>
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel ref={editorPanelRef} defaultSize={DEFAULT_EDITOR_SIZE} minSize={0}>
          <div className="flex flex-col h-full">
            <WritingEditor projectId={project.id} onWritingActivity={markWriting} />
            <div className="h-7 border-t border-border flex items-center px-4 shrink-0 bg-[hsl(var(--ethos-surface))]">
              <ProjectActivityBar projectId={project.id} />
            </div>
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel ref={chatPanelRef} defaultSize={DEFAULT_CHAT_SIZE} minSize={20}>
          <ChatPanel
            projectId={project.id}
            chatExpanded={chatExpanded}
            onToggleChat={handleToggleChat}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Dialogs */}
      <FlowConfirmDialog
        open={showConfirm}
        onConfirm={handleConfirmAnalysis}
        onCancel={() => setShowConfirm(false)}
      />
      <FlowTokenWarningDialog
        open={showTokenWarning}
        estimation={preCheck}
        onConfirm={handleTokenWarningConfirm}
        onCancel={handleTokenWarningCancel}
      />
    </div>
  );
}
