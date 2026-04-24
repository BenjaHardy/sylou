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
import { getBandForScore, getBandLabel } from "@/lib/flowBands";

/**
 * Returns the user-facing band label for a score. Numbers are never shown.
 * Kept here for backwards compatibility with existing call sites.
 */
export function getScoreLabel(score: number | null): string {
  return getBandLabel(score);
}

/**
 * Returns Tailwind utility classes for a score-tinted card surface, using
 * the band's bgColor as a soft background tint.
 */
export function getScoreColor(score: number | null): string {
  const band = getBandForScore(score);
  if (!band) return "bg-muted text-muted-foreground border-border";
  return "text-foreground border";
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
