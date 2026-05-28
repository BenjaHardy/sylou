import { useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { MEETSYLOU_URL } from "@/lib/about-content";
import { WelcomeDialog } from "@/components/WelcomeDialog";
import { DisclaimerViewDialog } from "@/components/DisclaimerViewDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * About menu entry. Hosts links + two buttons that open sibling viewers.
 * Buttons close About first, then open the sibling, to avoid stacked dialogs.
 */
export function AboutDialog({ open, onOpenChange }: Props) {
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);

  const openWelcome = () => {
    onOpenChange(false);
    setWelcomeOpen(true);
  };

  const openDisclaimer = () => {
    onOpenChange(false);
    setDisclaimerOpen(true);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>About Sylou</DialogTitle>
            <DialogDescription>
              Open-source text editor for visible human-AI collaboration in writing.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <a
              href={MEETSYLOU_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-primary hover:text-primary/80 underline underline-offset-2"
            >
              www.meetsylou.eu
              <ExternalLink className="h-3 w-3" />
            </a>

            <p className="text-xs text-muted-foreground">
              Sylou code is licensed under AGPL-3.0. The FLOW methodology is published separately
              under CC BY-SA 4.0.
            </p>

            <div className="flex flex-col gap-2 pt-2">
              <Button variant="outline" onClick={openWelcome}>
                View welcome
              </Button>
              <Button variant="outline" onClick={openDisclaimer}>
                View disclaimer
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <WelcomeDialog open={welcomeOpen} onOpenChange={setWelcomeOpen} />
      <DisclaimerViewDialog open={disclaimerOpen} onOpenChange={setDisclaimerOpen} />
    </>
  );
}
