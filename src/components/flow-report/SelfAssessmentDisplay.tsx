import { PILLAR_KEYS, PILLAR_LABELS, getScoreLabel } from "@/components/flow-report/shared-utils";
import type { FlowFeedback, FlowUserAssessment } from "@/hooks/useFlowAnalysis";

interface SelfAssessmentDisplayProps {
  preFeedbackScores: FlowFeedback | null;
  postAssessment: FlowUserAssessment | null;
}

export function SelfAssessmentDisplay({ preFeedbackScores, postAssessment }: SelfAssessmentDisplayProps) {
  if (!preFeedbackScores && !postAssessment) return null;

  return (
    <>
      {preFeedbackScores && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pre-Analysis Self-Assessment</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PILLAR_KEYS.map((key) => (
              <div key={key} className="border border-border rounded-lg p-3 text-center space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">{PILLAR_LABELS[key].full.split("—")[0].trim()}</p>
                <p className="text-lg font-bold text-foreground">{preFeedbackScores[key]?.toFixed(1) ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">{getScoreLabel(preFeedbackScores[key] ?? null)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {postAssessment && (
        <div className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Post-Analysis Self-Assessment</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PILLAR_KEYS.map((key) => (
              <div key={key} className="border border-border rounded-lg p-3 text-center space-y-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase">{PILLAR_LABELS[key].full.split("—")[0].trim()}</p>
                <p className="text-lg font-bold text-foreground">{postAssessment.scores[key]?.toFixed(1) ?? "—"}</p>
                <p className="text-[10px] text-muted-foreground">{getScoreLabel(postAssessment.scores[key] ?? null)}</p>
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
