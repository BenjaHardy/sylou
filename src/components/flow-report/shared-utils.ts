import {
  Search,
  Lightbulb,
  LayoutList,
  PenTool,
} from "lucide-react";
import type {
  FlowFeedback,
  FlowUserAssessment,
  FlowReport,
} from "@/hooks/useFlowAnalysis";

export function getScoreLabel(score: number | null): string {
  if (score == null) return "Insufficient evidence";
  if (score >= 4.5) return "Only Human";
  if (score >= 3.5) return "Largely Human";
  if (score >= 2.5) return "More Human";
  if (score >= 1.5) return "More AI";
  if (score >= 0.5) return "Largely AI";
  return "No human contribution detected";
}

export function getScoreColor(score: number | null): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 4.0) return "bg-[#5D89A8]/25 text-[#5D89A8] border-[#5D89A8]/40";
  if (score >= 3.0) return "bg-[#5D89A8]/20 text-[#5D89A8]/80 border-[#5D89A8]/35";
  if (score >= 2.0) return "bg-[#5D89A8]/15 text-[#5D89A8]/70 border-[#5D89A8]/30";
  if (score >= 1.0) return "bg-[#5D89A8]/10 text-[#5D89A8]/60 border-[#5D89A8]/20";
  return "bg-[#5D89A8]/5 text-[#5D89A8]/40 border-[#5D89A8]/10";
}

export const PILLAR_ICONS = {
  find: Search,
  lead: Lightbulb,
  organize: LayoutList,
  write: PenTool,
};

export const PILLAR_LABELS: Record<string, { short: string; full: string }> = {
  find: { short: "F", full: "Find — Research & Critical Thinking" },
  lead: { short: "L", full: "Lead — Ideas & Opinions" },
  organize: { short: "O", full: "Organize — Structure & Argumentation" },
  write: { short: "W", full: "Write — Writing & Text Production" },
};

export const PILLAR_TOOLTIPS: Record<string, string> = {
  find: "Identifies how the user researched relevant topics, whether they questioned the AI's outputs, compared alternatives, or challenged suggestions — versus relying on the AI without investigation.",
  lead: "Determines who is the true source of the ideas, opinions and perspectives in the final work.",
  organize: "Assesses how the ideas, opinions and perspectives are structured, and how the narrative and argumentation — supporting those ideas, opinions and perspectives — are developed.",
  write: "Analyzes the respective contributions to tone, style, clarity, correctness, sentence structure, transitions, and final drafting.",
};

export const PILLAR_KEYS = ["find", "lead", "organize", "write"] as const;

export function extractUserAssessment(feedback: FlowReport["user_feedback_post"]): FlowUserAssessment | null {
  if (!feedback) return null;
  if (typeof feedback === "object" && "scores" in feedback && "comments" in feedback) {
    return feedback as FlowUserAssessment;
  }
  const legacy = feedback as FlowFeedback;
  return {
    scores: legacy,
    comments: { find: "", lead: "", organize: "", write: "", overall: "" },
  };
}

export function extractFeedbackScores(feedback: FlowReport["user_feedback_post"]): FlowFeedback | null {
  if (!feedback) return null;
  if (typeof feedback === "object" && "scores" in feedback) {
    return (feedback as FlowUserAssessment).scores;
  }
  if (typeof feedback === "object" && "find" in feedback) {
    return feedback as FlowFeedback;
  }
  return null;
}
