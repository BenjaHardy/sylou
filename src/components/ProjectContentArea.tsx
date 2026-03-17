import { useState, useRef } from "react";
import { FolderOpen, Lightbulb, ChevronLeft, ChevronRight } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { WritingEditor } from "@/components/WritingEditor";
import { ChatPanel } from "@/components/ChatPanel";
import { ProjectActivityBar } from "@/components/ProjectActivityBar";
import { useActivityTracker } from "@/hooks/useActivityTracker";
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
            <li>• Choose a template that fits your writing style</li>
            <li>• Use the AI chat panel to brainstorm and refine ideas</li>
            <li>• Enable <span className="font-medium text-foreground">Tutor Mode</span> for guided learning</li>
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
  const chatPanelRef = useRef<ImperativePanelHandle>(null);
  const editorPanelRef = useRef<ImperativePanelHandle>(null);
  const { markWriting } = useActivityTracker(project?.id ?? null);

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

  return (
    <div className="flex-1 flex flex-col bg-background h-screen [&_[data-panel]]:transition-all [&_[data-panel]]:duration-150 [&_[data-panel]]:ease-ethos-ease">
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel ref={editorPanelRef} defaultSize={DEFAULT_EDITOR_SIZE} minSize={0}>
          <WritingEditor projectId={project.id} />
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
    </div>
  );
}
