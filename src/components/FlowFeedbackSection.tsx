import { useState } from "react";
import { Button } from "@/components/ui/button";
import { MessageSquareQuote } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BandSelector } from "@/components/flow-report/BandSelector";
import { getBandForScore } from "@/lib/flowBands";
import type { FlowFeedback } from "@/hooks/useFlowAnalysis";

interface Props {
  type: "pre" | "post";
  existingFeedback: FlowFeedback | null;
  onSubmit: (feedback: FlowFeedback) => void;
}

const PILLARS = [
  { key: "find" as const, label: "Find", desc: "Research & Critical Thinking" },
  { key: "lead" as const, label: "Lead", desc: "Ideas & Opinions" },
  { key: "organize" as const, label: "Organize", desc: "Structure & Argumentation" },
  { key: "write" as const, label: "Write", desc: "Writing & Text Production" },
];

const DEFAULT_SCORE = 2.25; // Collaborative midpoint

export function FlowFeedbackSection({ type, existingFeedback, onSubmit }: Props) {
  const [values, setValues] = useState<FlowFeedback>({
    find: DEFAULT_SCORE,
    lead: DEFAULT_SCORE,
    organize: DEFAULT_SCORE,
    write: DEFAULT_SCORE,
  });
  const [submitted, setSubmitted] = useState(!!existingFeedback);

  if (submitted && existingFeedback) {
    return (
      <div className="border border-border rounded-lg p-4 bg-muted/30">
        <p className="text-xs text-muted-foreground font-medium mb-3 flex items-center gap-1.5">
          <MessageSquareQuote className="h-3.5 w-3.5" />
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="cursor-help">
                  {type === "pre" ? "Self-assessment (pre-analysis feedback)" : "Self-assessment (post-analysis feedback)"}
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>{type === "pre" ? "Before viewing results" : "After viewing results"}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PILLARS.map((p) => {
            const band = getBandForScore(existingFeedback[p.key] ?? null);
            return (
              <div key={p.key} className="flex items-center justify-between gap-2 rounded-md bg-background/60 px-3 py-2">
                <span className="text-xs text-muted-foreground">{p.label}</span>
                <span
                  className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
                  style={
                    band
                      ? { backgroundColor: band.color, color: "#fff" }
                      : { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
                  }
                >
                  {band ? band.label : "—"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const handleSubmit = () => {
    onSubmit(values);
    setSubmitted(true);
  };

  return (
    <div className="border border-primary/20 rounded-lg p-4 bg-primary/5 space-y-4">
      <div>
        <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
          <MessageSquareQuote className="h-4 w-4 text-primary" />
          {type === "pre"
            ? "Before viewing detailed results, how would you describe your own contributions?"
            : "Now that you've seen the analysis, do you agree with the assessment?"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          For each pillar, pick the band that best describes the human-AI collaboration.
          {type === "pre" && (
            <> Pre-analysis user feedback is only possible the first time the FLOW analysis is run for a given project.</>
          )}
        </p>
      </div>
      <div className="space-y-3">
        {PILLARS.map((p) => (
          <div key={p.key} className="space-y-1.5">
            <span className="text-xs font-medium text-foreground">
              {p.label}{" "}
              <span className="text-muted-foreground font-normal">— {p.desc}</span>
            </span>
            <BandSelector
              value={values[p.key]}
              onChange={(v) => setValues((prev) => ({ ...prev, [p.key]: v }))}
              compact
            />
          </div>
        ))}
      </div>
      <Button size="sm" onClick={handleSubmit}>
        Submit
      </Button>
    </div>
  );
}
