import { BarChart3, Clock, Pencil, MessageSquare, Shield } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { MetricsSnapshot } from "@/hooks/useFlowAnalysis";

export function ProjectActivitySection({ metrics }: { metrics: MetricsSnapshot }) {
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5" />
        Project Activity (at analysis time)
      </h4>
      <div className="grid grid-cols-2 gap-y-2 text-xs">
        <TooltipProvider>
          <span className="text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><Clock className="h-3 w-3 cursor-help" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Total time the project was open and the user was actively interacting.</TooltipContent>
            </Tooltip>
            Active time
          </span>
          <span className="text-right font-medium text-foreground">{fmt(metrics.total_active_time_seconds)}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><Pencil className="h-3 w-3 cursor-help" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Time spent typing or editing in the writing editor.</TooltipContent>
            </Tooltip>
            Writing time
          </span>
          <span className="text-right font-medium text-foreground">{fmt(metrics.total_writing_time_seconds)}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><MessageSquare className="h-3 w-3 cursor-help" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Number of messages sent to the AI chat assistant.</TooltipContent>
            </Tooltip>
            Chat prompts
          </span>
          <span className="text-right font-medium text-foreground">{metrics.chat_prompt_count_normal + metrics.chat_prompt_count_tutor}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><Shield className="h-3 w-3 cursor-help" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Number of sanity checks performed.</TooltipContent>
            </Tooltip>
            Sanity checks
          </span>
          <span className="text-right font-medium text-foreground">{metrics.sanity_check_count}</span>
        </TooltipProvider>
      </div>
    </div>
  );
}
