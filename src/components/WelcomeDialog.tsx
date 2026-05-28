import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WelcomeBody } from "@/lib/about-content";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Read-only welcome viewer reachable from the About menu. Does NOT persist
 * any state — separate from FirstTimeWelcomeDialog by design so the gated
 * "shown" flag can never be touched accidentally from this surface.
 */
export function WelcomeDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Welcome to Sylou</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto pr-1 -mr-1">
          <WelcomeBody />
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
