import { useState } from "react";
import { Button } from "@/components/ui/button";
import FlowWorkProfile from "@/components/FlowWorkProfile";
import { FlowInfoSection } from "@/components/flow-report/FlowInfoSection";
import { SelfAssessmentDisplay } from "@/components/flow-report/SelfAssessmentDisplay";
import { getFlowProfile } from "@/lib/flow-work-profiles";
import type { FlowFeedback, FlowUserAssessment } from "@/hooks/useFlowAnalysis";

type ProfileSource = "ai" | "pre" | "post";

interface ProfileTabContentProps {
  aiScores: { find: number | null; lead: number | null; organize: number | null; write: number | null };
  preFeedbackScores: FlowFeedback | null;
  postAssessment: FlowUserAssessment | null;
  showSelfAssessment?: boolean;
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
}: ProfileTabContentProps) {
  const [source, setSource] = useState<ProfileSource>("ai");

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
      {/* About this FLOW Profile */}
      <FlowInfoSection title="About this FLOW Profile" />

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

      {/* Profile card with flip animation per source */}
      <div key={source} className="animate-card-flip space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground text-center">
          Your Collaboration Profile ({SOURCE_LABELS[source]})
        </h3>
        <FlowWorkProfile profile={activeProfile} scores={activeScores} />
      </div>

      {/* Self-assessment scores below */}
      {showSelfAssessment && (
        <SelfAssessmentDisplay
          preFeedbackScores={preFeedbackScores}
          postAssessment={postAssessment}
        />
      )}
    </div>
  );
}
