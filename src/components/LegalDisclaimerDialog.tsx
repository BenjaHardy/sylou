import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DisclaimerBody, DISCLAIMER_ACK_KEY } from "@/lib/about-content";

interface Props {
  open: boolean;
  onAcknowledge: () => void;
}

/**
 * Gated, non-dismissible legal disclaimer. The user MUST click "I understand"
 * to proceed. Escape key, overlay click, and close affordances are all disabled.
 */
export function LegalDisclaimerDialog({ open, onAcknowledge }: Props) {
  const handleAck = () => {
    try {
      localStorage.setItem(DISCLAIMER_ACK_KEY, new Date().toISOString());
    } catch {
      // localStorage may be unavailable (private mode, quota); proceed anyway.
    }
    onAcknowledge();
  };

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        className="max-w-2xl max-h-[85vh] flex flex-col"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Before you start</AlertDialogTitle>
        </AlertDialogHeader>
        <div className="overflow-y-auto pr-1 -mr-1">
          <DisclaimerBody />
          <p className="mt-4 text-sm text-muted-foreground">
            By clicking <span className="font-medium text-foreground">I understand</span>, you
            acknowledge these points.
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogAction onClick={handleAck}>I understand</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
