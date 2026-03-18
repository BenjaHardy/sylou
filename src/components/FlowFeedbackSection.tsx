import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { MessageSquareQuote } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

export function FlowFeedbackSection({ type, existingFeedback, onSubmit }: Props) {
  const [values, setValues] = useState<FlowFeedback>({
    find: 2.5,
    lead: 2.5,
    organize: 2.5,
    write: 2.5,
  });
  const [submitted, setSubmitted] = useState(!!existingFeedback);

  if (submitted && existingFeedback) {
    return (
      <div className="border border-border rounded-lg p-4 bg-muted/30">
        <p className="text-xs text-muted-foreground font-medium mb-2 flex items-center gap-1.5">
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
        <div className="grid grid-cols-4 gap-3 text-center">
          {PILLARS.map((p) => (
            <div key={p.key}>
              <span className="text-xs text-muted-foreground">{p.label}</span>
              <p className="text-lg font-bold text-foreground">{existingFeedback[p.key].toFixed(1)}</p>
            </div>
          ))}
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
            ? "Before viewing detailed results, how would you rate your own contributions?"
            : "Now that you've seen the analysis, do you agree with the scores?"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Rate each pillar from 0 (all AI) to 5 (all human). Use half-point increments.
        </p>
      </div>
      <div className="space-y-3">
        {PILLARS.map((p) => (
          <div key={p.key} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {p.label}{" "}
                <span className="text-muted-foreground font-normal">— {p.desc}</span>
              </span>
              <span className="text-sm font-bold text-foreground w-8 text-right">
                {values[p.key].toFixed(1)}
              </span>
            </div>
            <Slider
              min={0}
              max={5}
              step={0.5}
              value={[values[p.key]]}
              onValueChange={([v]) =>
                setValues((prev) => ({ ...prev, [p.key]: v }))
              }
              className="w-full"
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
