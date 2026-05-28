import { useState, useRef, useCallback } from "react";
import { DashboardSidebar } from "@/components/DashboardSidebar";
import { ProjectContentArea } from "@/components/ProjectContentArea";
import { NewProjectDialog } from "@/components/NewProjectDialog";
import { LegalDisclaimerDialog } from "@/components/LegalDisclaimerDialog";
import { FirstTimeWelcomeDialog } from "@/components/FirstTimeWelcomeDialog";
import { useProjects } from "@/hooks/useProjects";
import { DISCLAIMER_ACK_KEY, WELCOME_SHOWN_KEY } from "@/lib/about-content";

export default function Index() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [flowLoading, setFlowLoading] = useState(false);
  const { data: projects } = useProjects();
  const flushRef = useRef<(() => Promise<void>) | null>(null);

  // Reactive onboarding state. Initialized from localStorage on mount and
  // mutated via state when the user acknowledges/dismisses, so the welcome
  // appears the moment after disclaimer acknowledgement (no race, no missed
  // first-time welcome).
  const [disclaimerAcked, setDisclaimerAcked] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem(DISCLAIMER_ACK_KEY);
    } catch {
      return true; // fail-open to avoid blocking the app
    }
  });
  const [welcomeShown, setWelcomeShown] = useState<boolean>(() => {
    try {
      return !!localStorage.getItem(WELCOME_SHOWN_KEY);
    } catch {
      return true;
    }
  });

  const showDisclaimer = !disclaimerAcked;
  const showFirstTimeWelcome = disclaimerAcked && !welcomeShown;

  const selectedProject = projects?.find((p) => p.id === selectedId) ?? null;

  const handleSelectProject = useCallback(async (newId: string | null) => {
    if (newId === selectedId) return;
    if (flushRef.current) {
      await flushRef.current();
    }
    setSelectedId(newId);
  }, [selectedId]);

  return (
    <div className="flex h-screen w-full overflow-hidden">
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

      <LegalDisclaimerDialog
        open={showDisclaimer}
        onAcknowledge={() => setDisclaimerAcked(true)}
      />
      <FirstTimeWelcomeDialog
        open={showFirstTimeWelcome}
        onDismiss={() => setWelcomeShown(true)}
      />
    </div>
  );
}
