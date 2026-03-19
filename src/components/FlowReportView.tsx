import { useEffect, useState } from "react";
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ArrowLeft,
  Activity,
  Search,
  Lightbulb,
  LayoutList,
  PenTool,
  Zap,
  BarChart3,
  Clock,
  Pencil,
  MessageSquare,
  Shield,
  AlertTriangle,
  AlertOctagon,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FlowFeedbackSection } from "@/components/FlowFeedbackSection";
import { FlowUserAssessmentSection } from "@/components/FlowUserAssessmentSection";
import type {
  FlowReport,
  FlowPillar,
  FlowMeta,
  MetricsSnapshot,
  FlowFeedback,
  FlowUserAssessment,
} from "@/hooks/useFlowAnalysis";

interface Props {
  report: FlowReport | null;
  projectName: string;
  loading: boolean;
  onBack: () => void;
  onSaveFeedback: (type: "pre" | "post", feedback: FlowFeedback) => void;
  onSaveAssessment: (assessment: FlowUserAssessment) => void;
  /** Whether to show the pre-analysis self-assessment (first-ever analysis only) */
  showPreAnalysis: boolean;
}

/* ─── Score Calibration Labels ─── */
function getScoreLabel(score: number | null): string {
  if (score == null) return "Insufficient evidence";
  if (score >= 4.5) return "Only Human";
  if (score >= 3.5) return "Largely Human";
  if (score >= 2.5) return "More Human";
  if (score >= 1.5) return "More AI";
  if (score >= 0.5) return "Largely AI";
  return "No human contribution detected";
}

function getScoreColor(score: number | null): string {
  if (score == null) return "bg-muted text-muted-foreground";
  if (score >= 4.0) return "bg-green-500/15 text-green-600 border-green-500/30";
  if (score >= 3.0) return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
  if (score >= 2.0) return "bg-yellow-500/15 text-yellow-600 border-yellow-500/30";
  if (score >= 1.0) return "bg-orange-500/15 text-orange-600 border-orange-500/30";
  return "bg-destructive/15 text-destructive border-destructive/30";
}

const PILLAR_ICONS = {
  find: Search,
  lead: Lightbulb,
  organize: LayoutList,
  write: PenTool,
};

const PILLAR_LABELS: Record<string, { short: string; full: string }> = {
  find: { short: "F", full: "Find — Research & Critical Thinking" },
  lead: { short: "L", full: "Lead — Ideas & Opinions" },
  organize: { short: "O", full: "Organize — Structure & Argumentation" },
  write: { short: "W", full: "Write — Writing & Text Production" },
};

const PILLAR_TOOLTIPS: Record<string, string> = {
  find: "Identifies how the user researched relevant topics, whether they questioned the AI's outputs, compared alternatives, or challenged suggestions — versus relying on the AI without investigation.",
  lead: "Determines who is the true source of the ideas, opinions and perspectives in the final work.",
  organize: "Assesses how the ideas, opinions and perspectives are structured, and how the narrative and argumentation — supporting those ideas, opinions and perspectives — are developed.",
  write: "Analyzes the respective contributions to tone, style, clarity, correctness, sentence structure, transitions, and final drafting.",
};

/* ─── Radar Chart ─── */
function FlowRadarChart({ report }: { report: FlowReport }) {
  const data = [
    { pillar: "Find", score: report.ai_find.score ?? 0, fullMark: 5 },
    { pillar: "Lead", score: report.ai_lead.score ?? 0, fullMark: 5 },
    { pillar: "Organize", score: report.ai_organize.score ?? 0, fullMark: 5 },
    { pillar: "Write", score: report.ai_write.score ?? 0, fullMark: 5 },
  ];

  const hasNullScores = [
    report.ai_find.score,
    report.ai_lead.score,
    report.ai_organize.score,
    report.ai_write.score,
  ].some((s) => s == null);

  return (
    <div className="flex flex-col items-center">
      <h3 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5">
        <Activity className="h-4 w-4 text-primary" />
        FLOW Signature
      </h3>
      <ResponsiveContainer width={320} height={260}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="75%">
          <PolarGrid stroke="hsl(var(--border))" />
          <PolarAngleAxis
            dataKey="pillar"
            tick={{ fill: "hsl(var(--foreground))", fontSize: 12, fontWeight: 600 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 5]}
            tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
            tickCount={6}
          />
          <Radar
            name="FLOW"
            dataKey="score"
            stroke="hsl(var(--primary))"
            fill="hsl(var(--primary))"
            fillOpacity={0.2}
            strokeWidth={2}
            dot={{ r: 4, fill: "hsl(var(--primary))" }}
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: "hsl(var(--popover))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value: number) => [`${value.toFixed(1)} / 5.0`, "Score"]}
          />
        </RadarChart>
      </ResponsiveContainer>
      {hasNullScores && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
          <Info className="h-3 w-3" />
          Dashed axes indicate insufficient evidence
        </p>
      )}
    </div>
  );
}

/* ─── Score Card ─── */
function ScoreCard({
  pillarKey,
  pillar,
}: {
  pillarKey: string;
  pillar: FlowPillar;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = PILLAR_ICONS[pillarKey as keyof typeof PILLAR_ICONS];
  const labels = PILLAR_LABELS[pillarKey];
  const scoreLabel = getScoreLabel(pillar.score);
  const colorClasses = getScoreColor(pillar.score);

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${colorClasses}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="h-8 w-8 rounded-full bg-background/80 flex items-center justify-center cursor-help">
                  <Icon className="h-4 w-4" />
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">
                {PILLAR_TOOLTIPS[pillarKey]}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider">{labels.short}</p>
            <p className="text-[10px] opacity-80">{labels.full.split(" — ")[1]}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold leading-none">
            {pillar.score != null ? pillar.score.toFixed(1) : "—"}
          </p>
          <p className="text-[10px] opacity-70 mt-0.5">/ 5.0</p>
        </div>
      </div>
      <p className="text-xs font-semibold">{scoreLabel}</p>
      <p className="text-sm leading-relaxed opacity-90">{pillar.narrative}</p>
      {pillar.evidence.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Evidence</p>
          <ul className="text-xs space-y-1 opacity-80">
            {pillar.evidence.map((e, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="shrink-0 opacity-50">•</span>
                <span>{e}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {pillar.reasoning && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs font-medium flex items-center gap-1 opacity-70 hover:opacity-100 transition-opacity"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide reasoning" : "Explain this score"}
          </button>
          {expanded && (
            <div className="mt-2 text-xs leading-relaxed opacity-80 bg-background/50 rounded-md p-3">
              {pillar.reasoning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Token Usage Section ─── */
function TokenUsageSection({ meta }: { meta: FlowMeta }) {
  const ratio = meta.estimated_input_tokens / meta.context_limit_tokens;
  const pct = Math.round(ratio * 100);
  const status = meta.token_status;
  const StatusIcon = status === "over" ? AlertOctagon : status === "near" ? AlertTriangle : CheckCircle;
  const statusLabel = status === "over" ? "Over Limit" : status === "near" ? "Near Limit" : "OK";
  const statusColor = status === "over" ? "text-destructive" : status === "near" ? "text-yellow-600" : "text-green-600";

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Zap className="h-3.5 w-3.5 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              Shows how much of the AI model's context window was used for this analysis. Having more than 100% may negatively impact the FLOW analysis.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        Token usage
      </h4>
      <div className="grid grid-cols-2 gap-y-2 text-xs">
        <span className="text-muted-foreground">Estimated prompt tokens</span>
        <span className="text-right font-medium text-foreground">{meta.estimated_input_tokens.toLocaleString()}</span>
        <span className="text-muted-foreground">Context limit</span>
        <span className="text-right font-medium text-foreground">{meta.context_limit_tokens.toLocaleString()}</span>
        <span className="text-muted-foreground">Usage</span>
        <span className="text-right font-medium text-foreground">{pct}%</span>
        <span className="text-muted-foreground">Status</span>
        <span className={`text-right font-semibold flex items-center justify-end gap-1 ${statusColor}`}>
          <StatusIcon className="h-3 w-3" />
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

/* ─── Project Activity Section ─── */
function ProjectActivitySection({ metrics }: { metrics: MetricsSnapshot }) {
  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5" />
        Project Activity (at analysis time)
      </h4>
      <div className="grid grid-cols-2 gap-y-2 text-xs">
        <TooltipProvider>
          <span className="text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><Clock className="h-3 w-3 cursor-help" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Total time the project was open and the user was actively interacting (typing, clicking, scrolling).</TooltipContent>
            </Tooltip>
            Active time
          </span>
          <span className="text-right font-medium text-foreground">{fmt(metrics.total_active_time_seconds)}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><Pencil className="h-3 w-3 cursor-help" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Time spent typing or editing in the writing editor specifically.</TooltipContent>
            </Tooltip>
            Writing time
          </span>
          <span className="text-right font-medium text-foreground">{fmt(metrics.total_writing_time_seconds)}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><MessageSquare className="h-3 w-3 cursor-help" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Number of messages sent to the AI chat assistant.</TooltipContent>
            </Tooltip>
            Chat prompts
          </span>
          <span className="text-right font-medium text-foreground">{metrics.chat_prompt_count_normal + metrics.chat_prompt_count_tutor}</span>
          <span className="text-muted-foreground flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild><Shield className="h-3 w-3 cursor-help" /></TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs">Number of sanity checks performed on the project.</TooltipContent>
            </Tooltip>
            Sanity checks
          </span>
          <span className="text-right font-medium text-foreground">{metrics.sanity_check_count}</span>
        </TooltipProvider>
      </div>
    </div>
  );
}

/** Helper to extract FlowUserAssessment from the polymorphic user_feedback_post field */
function extractUserAssessment(feedback: FlowReport["user_feedback_post"]): FlowUserAssessment | null {
  if (!feedback) return null;
  if (typeof feedback === "object" && "scores" in feedback && "comments" in feedback) {
    return feedback as FlowUserAssessment;
  }
  // Legacy format: plain FlowFeedback scores only
  const legacy = feedback as FlowFeedback;
  return {
    scores: legacy,
    comments: { find: "", lead: "", organize: "", write: "", overall: "" },
  };
}

/* ─── Main Report View ─── */
export function FlowReportView({
  report,
  projectName,
  loading,
  onBack,
  onSaveFeedback,
  onSaveAssessment,
  showPreAnalysis,
}: Props) {
  const [preFeedbackViewed, setPreFeedbackViewed] = useState(false);

  // Show pre-feedback only if: showPreAnalysis is true AND no existing pre-feedback AND not yet viewed
  const showPreFeedback = showPreAnalysis && report ? !report.user_feedback_pre && !preFeedbackViewed : false;

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <div className="relative">
            <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Analyzing your project…</p>
            <p className="text-xs text-muted-foreground mt-1">This may take up to a minute</p>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">No report data available.</p>
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
            <ArrowLeft className="h-4 w-4" />
            Back to Editor
          </Button>
        </div>
      </div>
    );
  }

  const existingAssessment = extractUserAssessment(report.user_feedback_post);

  return (
    <div className="flex-1 flex flex-col bg-background h-screen">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center px-4 shrink-0 bg-[hsl(var(--ethos-surface))]">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to Editor
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{projectName}</span>
          <div className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Activity className="h-3.5 w-3.5" />
            FLOW Report
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
          {/* Pre-feedback (reflexivity) — only on first-ever analysis */}
          {showPreFeedback && (
            <div className="space-y-3">
              <FlowFeedbackSection
                type="pre"
                existingFeedback={null}
                onSubmit={(fb) => {
                  onSaveFeedback("pre", fb);
                  setPreFeedbackViewed(true);
                }}
              />
              <button
                onClick={() => setPreFeedbackViewed(true)}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Skip and view results
              </button>
            </div>
          )}

          {(!showPreFeedback || preFeedbackViewed) && (
            <>
              {/* Radar Chart */}
              <FlowRadarChart report={report} />

              {/* Score Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <ScoreCard pillarKey="find" pillar={report.ai_find} />
                <ScoreCard pillarKey="lead" pillar={report.ai_lead} />
                <ScoreCard pillarKey="organize" pillar={report.ai_organize} />
                <ScoreCard pillarKey="write" pillar={report.ai_write} />
              </div>

              {/* Overall Summary */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overall Summary</h4>
                <div className="bg-muted/50 rounded-lg p-5">
                  <p className="text-sm text-foreground leading-relaxed">{report.ai_summary}</p>
                </div>
              </div>

              {/* Pre-feedback display (if submitted) */}
              {report.user_feedback_pre && (
                <FlowFeedbackSection
                  type="pre"
                  existingFeedback={report.user_feedback_pre}
                  onSubmit={() => {}}
                />
              )}

              {/* Post-feedback scores (legacy display, if old format) */}
              {/* User Assessment (post-analysis): scores + free-text comments */}
              <FlowUserAssessmentSection
                existingAssessment={existingAssessment}
                onSubmit={onSaveAssessment}
              />

              {/* Token Usage */}
              {report.flow_meta && <TokenUsageSection meta={report.flow_meta} />}

              {/* Project Activity */}
              {report.metrics_snapshot && <ProjectActivitySection metrics={report.metrics_snapshot} />}

              {/* Metadata footer */}
              <div className="text-[10px] text-muted-foreground text-center space-y-0.5 pb-4">
                <p>
                  Model: {report.model_used} · Generated{" "}
                  {new Date(report.created_at).toLocaleString()}
                </p>
                <p>Project: {projectName}</p>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
