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
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

/**
 * Confirmation before accepting a reply the provider cut off at its output
 * limit (`truncated` on the done event). Accept stays available — the
 * user decides — but never silently: accepting replaces the whole
 * selection with an incomplete text.
 */
export function TruncatedAcceptDialog({ open, onOpenChange, onConfirm }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Accept a cut-off result?</AlertDialogTitle>
          <AlertDialogDescription>
            The AI stopped at its output limit before finishing, so this text is incomplete.
            Accepting replaces your whole selection with it — the part the AI never reached
            would be lost from the selection. You can undo with Ctrl+Z (Cmd+Z on Mac) right
            after accepting, or reject and work on a shorter passage.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Accept anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
