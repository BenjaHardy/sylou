import { FolderOpen, MessageSquare, Lightbulb } from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { WritingEditor } from "@/components/WritingEditor";
import type { Project } from "@/hooks/useProjects";
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

function EditorPlaceholder() {
  return (
    <div className="flex flex-col h-full">
      <div className="h-10 border-b border-border flex items-center px-4 shrink-0">
        <PenLine className="h-4 w-4 text-muted-foreground mr-2" />
        <span className="text-sm font-medium text-foreground">Editor</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Writing editor coming soon…</p>
      </div>
    </div>
  );
}

function ChatPlaceholder() {
  return (
    <div className="flex flex-col h-full">
      <div className="h-10 border-b border-border flex items-center px-4 shrink-0">
        <MessageSquare className="h-4 w-4 text-muted-foreground mr-2" />
        <span className="text-sm font-medium text-foreground">Chat</span>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Chat panel coming soon…</p>
      </div>
    </div>
  );
}

export function ProjectContentArea({ project }: Props) {
  if (!project) return <WelcomeScreen />;

  return (
    <div className="flex-1 flex flex-col bg-background h-screen">
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        <ResizablePanel defaultSize={60} minSize={30}>
          <EditorPlaceholder />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={40} minSize={25}>
          <ChatPlaceholder />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
