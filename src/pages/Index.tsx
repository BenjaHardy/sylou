import { useState } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { ProjectContentArea } from "@/components/ProjectContentArea";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { useProjects } from "@/hooks/useProjects";

export default function Index() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const { data: projects } = useProjects();

  const selectedProject = projects?.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex min-h-screen w-full">
      <DashboardSidebar
        selectedProjectId={selectedId}
        onSelectProject={setSelectedId}
        onNewProject={() => setNewDialogOpen(true)}
      />
      <ProjectContentArea project={selectedProject} />
      <NewProjectDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        onCreated={(id) => setSelectedId(id)}
      />
    </div>
  );
}
