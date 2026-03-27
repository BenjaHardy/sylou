import { useState, useRef, useCallback } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { ProjectContentArea } from "@/components/ProjectContentArea";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { useProjects } from "@/hooks/useProjects";

export default function Index() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [flowLoading, setFlowLoading] = useState(false);
  const { data: projects } = useProjects();
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  const selectedProject = projects?.find((p) => p.id === selectedId) ?? null;

  const handleSelectProject = useCallback(async (newId: string | null) => {
    if (newId === selectedId) return;
    // Flush current project's writing content + provenance before switching
    if (flushRef.current) {
      await flushRef.current();
    }
    setSelectedId(newId);
  }, [selectedId]);

  return (
    <div className="flex min-h-screen w-full">
      <DashboardSidebar
        selectedProjectId={selectedId}
        onSelectProject={handleSelectProject}
        onNewProject={() => setNewDialogOpen(true)}
        disabled={flowLoading}
      />
      <ProjectContentArea
        project={selectedProject}
        onFlowLoadingChange={setFlowLoading}
        onFlushRef={(fn) => { flushRef.current = fn; }}
      />
      <NewProjectDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}
