import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, AlertOctagon } from "lucide-react";
import type { TokenEstimation } from "@/lib/estimateTokens";

interface Props {
  open: boolean;
  estimation: TokenEstimation | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export function FlowTokenWarningDialog({ open, estimation, onConfirm, onCancel }: Props) {
  if (!estimation) return null;

  const pct = Math.round(estimation.ratio * 100);
  const isNear = estimation.status === "near";
  const isOver = estimation.status === "over";

  const StatusIcon = isOver ? AlertOctagon : isNear ? AlertTriangle : CheckCircle;
  const statusLabel = isOver ? "Over Limit" : isNear ? "Near Limit" : "OK";
  const statusColor = isOver
    ? "text-destructive"
    : isNear
    ? "text-yellow-500"
    : "text-green-500";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StatusIcon className={`h-5 w-5 ${statusColor}`} />
            Token Estimation
          </DialogTitle>
          <DialogDescription>
            {isOver
              ? "The estimated prompt size exceeds the model's context window. The analysis may be truncated or fail."
              : isNear
              ? "The estimated prompt is approaching the model's context limit. The analysis should work but may be tight."
              : "The prompt fits comfortably within the context window."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Estimated prompt tokens</span>
            <span className="font-medium">{estimation.estimatedTokens.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Context limit</span>
            <span className="font-medium">{estimation.contextLimit.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Usage</span>
            <span className="font-medium">{pct}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status</span>
            <span className={`font-semibold ${statusColor}`}>{statusLabel}</span>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>
            {isOver ? "Run Anyway" : "Run Analysis"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
