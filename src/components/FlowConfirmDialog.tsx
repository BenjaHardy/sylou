import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function FlowConfirmDialog({ open, onConfirm, onCancel }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Run FLOW Analysis?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">
              <p className="mb-3">
                This will assess the balance of your contributions with the AI
                across the four FLOW pillars:
              </p>
              <ul className="mb-3 space-y-1 list-none pl-0">
                <li><strong>F – Find:</strong> Research and critical thinking.</li>
                <li><strong>L – Lead:</strong> Ideas and opinion.</li>
                <li><strong>O – Organize:</strong> Structure and argumentation.</li>
                <li><strong>W – Write:</strong> Writing and authorship.</li>
              </ul>
              <p className="mb-2">
                The analysis uses your writing content, chat history, and editor activity.
              </p>
              <p>
                All your data stay private and are not used to train any large language model.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Run Analysis
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
