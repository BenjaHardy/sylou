import { useState } from "react";
import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import FlowWorkProfile from "@/components/FlowWorkProfile";
import { FlowInfoSection } from "@/components/flow-report/FlowInfoSection";
import { SelfAssessmentDisplay } from "@/components/flow-report/SelfAssessmentDisplay";
import { TokenUsageSection } from "@/components/flow-report/TokenUsageSection";
import { ProjectActivitySection } from "@/components/flow-report/ProjectActivitySection";
import { getFlowProfile } from "@/lib/flow-work-profiles";
import type { FlowFeedback, FlowUserAssessment, FlowReport } from "@/hooks/useFlowAnalysis";

type ProfileSource = "ai" | "pre" | "post";

interface ProfileTabContentProps {
  aiScores: { find: number | null; lead: number | null; organize: number | null; write: number | null };
  preFeedbackScores: FlowFeedback | null;
  postAssessment: FlowUserAssessment | null;
  showSelfAssessment?: boolean;
  flowMeta?: FlowReport["flow_meta"] | null;
  metricsSnapshot?: FlowReport["metrics_snapshot"] | null;
  /** Optional controlled source (used by SharedReport to drive tab-aware AI markers). */
  source?: ProfileSource;
  onSourceChange?: (source: ProfileSource) => void;
  /** AI model display name; required to mark the AI-derived profile card. */
  aiModelName?: string;
}

const SOURCE_LABELS: Record<ProfileSource, string> = {
  ai: "AI assessment",
  pre: "Self-assessment — pre-analysis",
  post: "Self-assessment — post-analysis",
};

export function ProfileTabContent({
  aiScores,
  preFeedbackScores,
  postAssessment,
  showSelfAssessment = true,
  flowMeta = null,
  metricsSnapshot = null,
  source: controlledSource,
  onSourceChange,
  aiModelName,
}: ProfileTabContentProps) {
  const [uncontrolledSource, setUncontrolledSource] = useState<ProfileSource>("ai");
  const source = controlledSource ?? uncontrolledSource;
  const setSource = (next: ProfileSource) => {
    if (onSourceChange) onSourceChange(next);
    else setUncontrolledSource(next);
  };

  const postFeedbackScores = postAssessment?.scores ?? null;

  const aiProfile = getFlowProfile(aiScores);
  const preProfile = preFeedbackScores ? getFlowProfile(preFeedbackScores) : null;
  const postProfile = postFeedbackScores ? getFlowProfile(postFeedbackScores) : null;

  const hasAlternatives = !!preProfile || !!postProfile;

  let activeProfile = aiProfile;
  let activeScores = aiScores;
  if (source === "pre" && preProfile && preFeedbackScores) {
    activeProfile = preProfile;
    activeScores = preFeedbackScores;
  } else if (source === "post" && postProfile && postFeedbackScores) {
    activeProfile = postProfile;
    activeScores = postFeedbackScores;
  }

  if (!activeProfile) return null;

  return (
    <div className="space-y-6">
      {/* About this FLOW Collaboration Style */}
      <FlowInfoSection title="About this FLOW Collaboration Style" />

      {/* Sub-tabs for assessment source */}
      {hasAlternatives && (
        <div className="flex flex-wrap items-center justify-center gap-1">
          <Button
            variant={source === "ai" ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs px-3"
            onClick={() => setSource("ai")}
          >
            AI assessment
          </Button>
          {preProfile && (
            <Button
              variant={source === "pre" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setSource("pre")}
            >
              Self-assessment (pre)
            </Button>
          )}
          {postProfile && (
            <Button
              variant={source === "post" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setSource("post")}
            >
              Self-assessment (post)
            </Button>
          )}
        </div>
      )}

      {/* Profile card with flip animation per source. Only the AI-derived
          variant carries Article 50(2) machine-readable markers; pre/post
          self-assessment variants are human-authored and stay unmarked. */}
      {source === "ai" ? (
        <section
          key={source}
          data-ai-generated="true"
          data-ai-model={aiModelName}
          aria-label="AI-derived collaboration style"
          className="animate-card-flip space-y-4"
        >
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">
            Your Collaboration Style ({SOURCE_LABELS[source]})
          </h3>
          <FlowWorkProfile profile={activeProfile} scores={activeScores} />
        </section>
      ) : (
        <div key={source} className="animate-card-flip space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">
            Your Collaboration Style ({SOURCE_LABELS[source]})
          </h3>
          <FlowWorkProfile profile={activeProfile} scores={activeScores} />
        </div>
      )}

      {/* Self-assessment scores below */}
      {showSelfAssessment && (
        <SelfAssessmentDisplay
          preFeedbackScores={preFeedbackScores}
          postAssessment={postAssessment}
        />
      )}

      {/* Token Usage */}
      {flowMeta && <TokenUsageSection meta={flowMeta} />}

      {/* Imported Documents Notices */}
      {flowMeta?.imported_documents_mode === "summaries" && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Imported documents were included as summaries due to context length limits.</span>
        </div>
      )}
      {flowMeta?.imported_documents_mode === "excluded" && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>Imported documents ({flowMeta.imported_documents_count}) were excluded from this analysis due to context length limits.</span>
        </div>
      )}

      {/* Project Activity */}
      {metricsSnapshot && <ProjectActivitySection metrics={metricsSnapshot} />}
    </div>
  );
}
