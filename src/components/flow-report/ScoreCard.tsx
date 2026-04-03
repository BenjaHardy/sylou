import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getScoreLabel, getScoreColor, PILLAR_ICONS, PILLAR_LABELS, PILLAR_TOOLTIPS } from "./shared-utils";
import type { FlowPillar } from "@/hooks/useFlowAnalysis";

interface ScoreCardProps {
  pillarKey: string;
  pillar: FlowPillar;
}

export function ScoreCard({ pillarKey, pillar }: ScoreCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = PILLAR_ICONS[pillarKey as keyof typeof PILLAR_ICONS];
  const labels = PILLAR_LABELS[pillarKey];
  const scoreLabel = getScoreLabel(pillar.score);
  const colorClasses = getScoreColor(pillar.score);

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${colorClasses}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="h-8 w-8 rounded-full bg-background/80 flex items-center justify-center cursor-help">
                  <Icon className="h-4 w-4" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {PILLAR_TOOLTIPS[pillarKey]}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider">{labels.short}</p>
            <p className="text-[10px] opacity-80">{labels.full.split(" — ")[1]}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold leading-none">
            {pillar?.score != null ? Number(pillar.score).toFixed(1) : "—"}
          </p>
          <p className="text-[10px] opacity-70 mt-0.5">/ 5.0</p>
        </div>
      </div>
      <p className="text-xs font-semibold">{scoreLabel}</p>
      <p className="text-sm leading-relaxed opacity-90">{pillar?.narrative ?? ""}</p>
      {(() => {
        const evidence = Array.isArray(pillar?.evidence) ? pillar.evidence : [];
        return evidence.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Evidence</p>
            <ul className="text-xs space-y-1 opacity-80">
              {evidence.map((e: string, i: number) => (
                <li key={i} className="flex gap-1.5">
                  <span className="shrink-0 opacity-50">•</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })()}
      {pillar?.reasoning && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide reasoning" : "Explain this score"}
          </button>
          {expanded && (
            <div className="mt-2 text-xs leading-relaxed opacity-80 bg-background/50 rounded-md p-3">
              {pillar.reasoning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
