import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DisclaimerBody } from "@/lib/about-content";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Read-only disclaimer viewer reachable from the About menu. Standard Dialog
 * (NOT AlertDialog) with normal dismiss behavior. Does NOT persist any state —
 * separate from LegalDisclaimerDialog by design so the gated acknowledgement
 * flag can never be touched accidentally from this surface.
 */
export function DisclaimerViewDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Before you start</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto pr-1 -mr-1">
          <DisclaimerBody />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
