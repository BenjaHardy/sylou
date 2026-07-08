import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
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
  const flushRef = useRef<(() => Promise<boolean>) | null>(null);

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
      const flushed = await flushRef.current();
      if (!flushed) {
        // The latest changes did NOT reach the DB (e.g. offline). Switching
        // would discard them with the editor remount — stay put instead.
        toast.error("Couldn't save your latest changes", {
          description:
            "Staying on this project so nothing is lost. Check your connection and try again.",
          action: {
            label: "Switch anyway",
            onClick: () => setSelectedId(newId),
          },
        });
        return;
      }
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
        onCreated={handleSelectProject}
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
