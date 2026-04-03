import { AlertOctagon, AlertTriangle, CheckCircle, Zap } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { FlowMeta } from "@/hooks/useFlowAnalysis";

export function TokenUsageSection({ meta }: { meta: FlowMeta }) {
  const ratio = meta.estimated_input_tokens / meta.context_limit_tokens;
  const pct = Math.round(ratio * 100);
  const status = meta.token_status;
  const StatusIcon = status === "over" ? AlertOctagon : status === "near" ? AlertTriangle : CheckCircle;
  const statusLabel = status === "over" ? "Over Limit" : status === "near" ? "Near Limit" : "OK";
  const statusColor = status === "over" ? "text-destructive" : status === "near" ? "text-yellow-600" : "text-green-600";

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Zap className="h-3.5 w-3.5 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              Shows how much of the AI model's context window was used for this analysis. Having more than 100% may negatively impact the FLOW analysis.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        Token usage
      </h4>
      <div className="grid grid-cols-2 gap-y-2 text-xs">
        <span className="text-muted-foreground">Estimated prompt tokens</span>
        <span className="text-right font-medium text-foreground">{meta.estimated_input_tokens.toLocaleString()}</span>
        <span className="text-muted-foreground">Context limit</span>
        <span className="text-right font-medium text-foreground">{meta.context_limit_tokens.toLocaleString()}</span>
        <span className="text-muted-foreground">Usage</span>
        <span className="text-right font-medium text-foreground">{pct}%</span>
        <span className="text-muted-foreground">Status</span>
        <span className={`text-right font-semibold flex items-center justify-end gap-1 ${statusColor}`}>
          <StatusIcon className="h-3 w-3" />
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
