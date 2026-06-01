import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MessageSquareQuote, Pencil, Check } from "lucide-react";
import { BandSelector } from "@/components/flow-report/BandSelector";
import { getBandForScore } from "@/lib/flowBands";
import type { FlowUserAssessment, FlowFeedback } from "@/hooks/useFlowAnalysis";

const PILLARS = [
  { key: "find" as const, label: "Find", desc: "Research & Critical Thinking" },
  { key: "lead" as const, label: "Lead", desc: "Ideas & Opinions" },
  { key: "organize" as const, label: "Organize", desc: "Structure & Argumentation" },
  { key: "write" as const, label: "Write", desc: "Writing & Text Production" },
];

const DEFAULT_SCORE = 2.25; // Collaborative midpoint

interface Props {
  existingAssessment: FlowUserAssessment | null;
  onSubmit: (assessment: FlowUserAssessment) => void;
}

export function FlowUserAssessmentSection({ existingAssessment, onSubmit }: Props) {
  const [editing, setEditing] = useState(!existingAssessment);
  const [scores, setScores] = useState<FlowFeedback>(
    existingAssessment?.scores ?? { find: DEFAULT_SCORE, lead: DEFAULT_SCORE, organize: DEFAULT_SCORE, write: DEFAULT_SCORE }
  );
  const [comments, setComments] = useState<FlowUserAssessment["comments"]>(
    existingAssessment?.comments ?? { find: "", lead: "", organize: "", write: "", overall: "" }
  );

  const handleSubmit = () => {
    onSubmit({ scores, comments });
    setEditing(false);
  };

  // Read-only view
  if (!editing && existingAssessment) {
    return (
      <div className="border border-border rounded-lg p-4 bg-muted/30 space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
            <MessageSquareQuote className="h-3.5 w-3.5" />
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help">Self-assessment (post-analysis feedback by user)</span>
                </TooltipTrigger>
                <TooltipContent>
                  <p>After viewing results</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </p>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="gap-1 h-7 text-xs">
            <Pencil className="h-3 w-3" />
            Edit
          </Button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {PILLARS.map((p) => {
            const band = getBandForScore(existingAssessment.scores[p.key] ?? null);
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
        {PILLARS.map((p) =>
          existingAssessment.comments[p.key] ? (
            <div key={p.key} className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">{p.label}</p>
              <p className="text-sm text-foreground bg-background/50 rounded-md p-2">{existingAssessment.comments[p.key]}</p>
            </div>
          ) : null
        )}
        {existingAssessment.comments.overall && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">Overall</p>
            <p className="text-sm text-foreground bg-background/50 rounded-md p-2">{existingAssessment.comments.overall}</p>
          </div>
        )}
      </div>
    );
  }

  // Editable form
  return (
    <div className="border border-primary/20 rounded-lg p-4 bg-primary/5 space-y-4">
      <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
        <MessageSquareQuote className="h-4 w-4 text-primary" />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help">Self-assessment (post-analysis feedback by user)</span>
            </TooltipTrigger>
            <TooltipContent>
              <p>After viewing results</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </p>
      <p className="text-xs text-muted-foreground">
        For each pillar, pick the band that best describes the human-AI collaboration. Comments are optional.
      </p>

      <div className="space-y-4">
        {PILLARS.map((p) => (
          <div key={p.key} className="space-y-2">
            <span className="text-xs font-medium text-foreground">
              {p.label}{" "}
              <span className="text-muted-foreground font-normal">— {p.desc}</span>
            </span>
            <BandSelector
              value={scores[p.key]}
              onChange={(v) => setScores((prev) => ({ ...prev, [p.key]: v }))}
              compact
            />
            <Textarea
              placeholder={`Comment on ${p.label} (optional)…`}
              value={comments[p.key]}
              onChange={(e) => setComments((prev) => ({ ...prev, [p.key]: e.target.value }))}
              className="min-h-[60px] text-sm"
            />
          </div>
        ))}

        <div className="space-y-2">
          <span className="text-xs font-medium text-foreground">Overall comment</span>
          <Textarea
            placeholder="Overall feedback on the FLOW analysis (optional)…"
            value={comments.overall}
            onChange={(e) => setComments((prev) => ({ ...prev, overall: e.target.value }))}
            className="min-h-[80px] text-sm"
          />
        </div>
      </div>

      <Button size="sm" onClick={handleSubmit} className="gap-1.5">
        <Check className="h-3.5 w-3.5" />
        {existingAssessment ? "Update" : "Submit"}
      </Button>
    </div>
  );
}
