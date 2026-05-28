import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WelcomeBody, WELCOME_SHOWN_KEY } from "@/lib/about-content";

interface Props {
  open: boolean;
  onDismiss: () => void;
}

/**
 * First-time-only welcome modal, shown once after the disclaimer is acknowledged.
 * Persists a "shown" flag on dismissal; re-openable from the About menu via
 * WelcomeDialog (which does NOT touch the persisted flag).
 */
export function FirstTimeWelcomeDialog({ open, onDismiss }: Props) {
  const handleDismiss = () => {
    try {
      localStorage.setItem(WELCOME_SHOWN_KEY, "true");
    } catch {
      // ignore
    }
    onDismiss();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleDismiss()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Welcome to Sylou</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto pr-1 -mr-1">
          <WelcomeBody />
        </div>
        <DialogFooter>
          <Button onClick={handleDismiss}>Dismiss</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
