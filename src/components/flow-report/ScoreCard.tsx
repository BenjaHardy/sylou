import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { PILLAR_ICONS, PILLAR_LABELS, PILLAR_TOOLTIPS } from "./shared-utils";
import { getBandForScore } from "@/lib/flowBands";
import type { FlowPillar } from "@/hooks/useFlowAnalysis";

interface ScoreCardProps {
  pillarKey: string;
  pillar: FlowPillar;
}

export function ScoreCard({ pillarKey, pillar }: ScoreCardProps) {
  const [expanded, setExpanded] = useState(false);
  const Icon = PILLAR_ICONS[pillarKey as keyof typeof PILLAR_ICONS];
  const labels = PILLAR_LABELS[pillarKey];
  const band = getBandForScore(pillar?.score ?? null);

  const cardStyle = band
    ? { backgroundColor: band.bgColor, borderColor: band.color + "55" }
    : undefined;

  return (
    <div
      className="rounded-lg border p-4 space-y-3 text-foreground"
      style={cardStyle}
    >
      <div className="flex items-start justify-between gap-3">
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
        <span
          className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap"
          style={
            band
              ? { backgroundColor: band.color, color: "#fff" }
              : { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
          }
        >
          {band ? band.label : "Insufficient evidence"}
        </span>
      </div>
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
            {expanded ? "Hide reasoning" : "Explain this assessment"}
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
