import { PILLAR_KEYS, PILLAR_LABELS } from "@/components/flow-report/shared-utils";
import { getBandForScore } from "@/lib/flowBands";
import type { FlowFeedback, FlowUserAssessment } from "@/hooks/useFlowAnalysis";

interface SelfAssessmentDisplayProps {
  preFeedbackScores: FlowFeedback | null;
  postAssessment: FlowUserAssessment | null;
}

function BandChip({ score }: { score: number | null | undefined }) {
  const band = getBandForScore(score ?? null);
  const isNA = score === null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
      style={
        band
          ? { backgroundColor: band.color, color: "#fff" }
          : { backgroundColor: "hsl(var(--muted))", color: "hsl(var(--muted-foreground))" }
      }
    >
      {band ? band.label : isNA ? "Not applicable" : "Insufficient evidence"}
    </span>
  );
}

export function SelfAssessmentDisplay({ preFeedbackScores, postAssessment }: SelfAssessmentDisplayProps) {
  if (!preFeedbackScores && !postAssessment) return null;

  return (
    <>
      {preFeedbackScores && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pre-Analysis Self-Assessment (by User)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PILLAR_KEYS.map((key) => (
              <div key={key} className="border border-border rounded-lg p-3 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase">
                  {PILLAR_LABELS[key].full.split("—")[0].trim()}
                </p>
                <BandChip score={preFeedbackScores[key]} />
              </div>
            ))}
          </div>
        </div>
      )}

      {postAssessment && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Post-Analysis Self-Assessment (by User)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {PILLAR_KEYS.map((key) => (
              <div key={key} className="border border-border rounded-lg p-3 flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase">
                  {PILLAR_LABELS[key].full.split("—")[0].trim()}
                </p>
                <BandChip score={postAssessment.scores[key]} />
              </div>
            ))}
          </div>
          {Object.entries(postAssessment.comments).some(([, v]) => v.trim()) && (
            <div className="space-y-2 mt-2">
              {PILLAR_KEYS.map((key) =>
                postAssessment.comments[key]?.trim() ? (
                  <div key={key} className="bg-muted/30 rounded-md p-3">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">{PILLAR_LABELS[key].full.split("—")[0].trim()}</p>
                    <p className="text-xs text-foreground">{postAssessment.comments[key]}</p>
                  </div>
                ) : null
              )}
              {postAssessment.comments.overall?.trim() && (
                <div className="bg-muted/30 rounded-md p-3">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase mb-1">Overall</p>
                  <p className="text-xs text-foreground">{postAssessment.comments.overall}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
