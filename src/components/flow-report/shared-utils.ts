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
  if (score >= 4.0) return "bg-green-500/15 text-green-600 border-green-500/30";
  if (score >= 3.0) return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
  if (score >= 2.0) return "bg-yellow-500/15 text-yellow-600 border-yellow-500/30";
  if (score >= 1.0) return "bg-orange-500/15 text-orange-600 border-orange-500/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
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
