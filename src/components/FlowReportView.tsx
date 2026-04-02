import { useEffect, useRef, useState, useCallback, Component, type ReactNode, type ErrorInfo } from "react";

class HighlightedTextErrorBoundary extends Component<
  { children: ReactNode; onClose: () => void },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[FlowHighlightedText crash]", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="absolute inset-0 z-10 bg-background flex flex-col items-center justify-center gap-4">
          <p className="text-muted-foreground">Something went wrong rendering the highlighted text.</p>
          <button
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm"
            onClick={this.props.onClose}
          >
            Back to Report
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
import { supabase } from "@/integrations/supabase/client";
import { FlowHighlightedText } from "@/components/FlowHighlightedText";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowLeft,
  Activity,
  Search,
  Lightbulb,
  LayoutList,
  PenTool,
  Zap,
  Eye,
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
  ExternalLink,
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

const PILLAR_KEYS = ["find", "lead", "organize", "write"] as const;

/* ─── Custom Radar Tooltip ─── */
function CustomRadarTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;

  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-md text-xs space-y-1">
      <p className="font-semibold text-foreground">{item.pillar}</p>
      {item.aiScore != null ? (
        <p className="text-blue-500">AI: {item.aiScore.toFixed(1)} — {getScoreLabel(item.aiScore)}</p>
      ) : (
        <p className="text-muted-foreground">AI: Insufficient evidence</p>
      )}
      {item.userScore != null && (
        <p style={{ color: item.userColor }}>
          User: {item.userScore.toFixed(1)} — {getScoreLabel(item.userScore)}
        </p>
      )}
    </div>
  );
}

/* ─── Radar Chart with dual overlay ─── */
function FlowRadarChart({
  report,
  userFeedback,
  userLabel,
  userColor,
}: {
  report: FlowReport;
  userFeedback: FlowFeedback | null;
  userLabel: string;
  userColor: string;
}) {
  const pillars = [
    { key: "find", pillar: "Find" },
    { key: "lead", pillar: "Lead" },
    { key: "organize", pillar: "Organize" },
    { key: "write", pillar: "Write" },
  ];

  const aiScores: Record<string, number | null> = {
    find: report.ai_find.score,
    lead: report.ai_lead.score,
    organize: report.ai_organize.score,
    write: report.ai_write.score,
  };

  const data = pillars.map(({ key, pillar }) => {
    const aiRaw = aiScores[key];
    const userRaw = userFeedback?.[key as keyof FlowFeedback] ?? null;
    return {
      pillar,
      aiScore: aiRaw,
      aiDisplay: aiRaw ?? 0,
      userScore: userRaw,
      userDisplay: userRaw ?? 0,
      userColor,
      isNull: aiRaw == null,
    };
  });

  const hasNullScores = data.some((d) => d.isNull);
  const hasUser = userFeedback != null;

  // Determine fill/stroke colors
  const aiStroke = "hsl(217, 91%, 60%)"; // blue-500
  const aiFill = "hsl(217, 91%, 60%)";
  const userStroke = userColor;
  const userFill = userColor;

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
          {/* AI scores layer */}
          <Radar
            name="AI Assessment"
            dataKey="aiDisplay"
            stroke={aiStroke}
            fill={aiFill}
            fillOpacity={0.25}
            strokeWidth={2}
            strokeDasharray={hasNullScores ? "6 3" : undefined}
            dot={({ cx, cy, index }: any) => {
              const d = data[index];
              if (d?.isNull) {
                return (
                  <circle
                    key={index}
                    cx={cx}
                    cy={cy}
                    r={4}
                    fill="none"
                    stroke={aiStroke}
                    strokeWidth={2}
                    strokeDasharray="3 2"
                  />
                );
              }
              return <circle key={index} cx={cx} cy={cy} r={4} fill={aiStroke} />;
            }}
          />
          {/* User scores layer */}
          {hasUser && (
            <Radar
              name={userLabel}
              dataKey="userDisplay"
              stroke={userStroke}
              fill={userFill}
              fillOpacity={0.2}
              strokeWidth={2}
              dot={{ r: 3, fill: userStroke }}
            />
          )}
          <RechartsTooltip content={<CustomRadarTooltip />} />
        </RadarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: aiFill, opacity: 0.6 }} />
          <span className="text-muted-foreground">Blue = AI Assessment</span>
        </span>
        {hasUser && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: userFill, opacity: 0.6 }} />
            <span className="text-muted-foreground">{userLabel === "Pre-analysis" ? "Green = User Assessment (Pre-analysis)" : "Orange = User Assessment (Post-analysis)"}</span>
          </span>
        )}
      </div>

      {hasNullScores && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-1">
          <Info className="h-3 w-3" />
          Dashed lines/markers indicate insufficient evidence
        </p>
      )}
    </div>
  );
}

/* ─── About FLOW Collapsible ─── */
function FlowInfoSection() {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors group">
        <Info className="h-3.5 w-3.5" />
        <span className="underline underline-offset-2">About this FLOW Report</span>
        <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        <div className="border border-border rounded-lg p-5 bg-muted/30 space-y-4 text-sm text-foreground leading-relaxed">
          <div>
            <p className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">What is FLOW?</p>
            <p>
              FLOW is Ethos's proprietary analytical framework that assesses human-AI collaboration across four pillars,
              each representing a distinct intellectual process in producing written work:{" "}
              Find (research it), Lead (form ideas about it),{" "}
              Organize (structure it), Write (write it).
            </p>
          </div>
          <div>
            <p className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">Purpose</p>
            <p>
              FLOW promotes transparency in AI-assisted writing. AI assistance is not inherently good or bad, though
              transparency is useful. Ethos makes the collaboration process visible, measurable, and verifiable.
            </p>
          </div>
          <div>
            <p className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">How to read scores</p>
            <p>
              Scores range from 0.0 (no human contribution detected) to 5.0 (entirely human). Scores are analytical,
              not moral. A score of 2.0 ("More AI") is not "bad", it means the AI contributed significantly to that
              aspect. A score of 5.0 is not inherently "better", effective AI collaboration (3.0–4.0) may produce
              superior outcomes. FLOW provides transparency; interpretation depends on context.
            </p>
          </div>
          <div>
            <p className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-1">About the AI Assessment</p>
            <p>
              The AI assessment is generated by a large language model analyzing the full project data (writing, chat
              history, and provenance metadata). Like any AI system, results may vary slightly between runs. The AI
              assessment should be considered alongside the user's own self-assessment when available, as well as the
              other reports and data provided.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Learn more at{" "}
            <a
              href="https://www.thisisethos.eu"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              www.thisisethos.eu
            </a>
          </p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/* ─── Report Footer ─── */
function FlowReportFooter() {
  return (
    <div className="border-t border-border pt-6 pb-8 mt-8 text-center space-y-2">
      <a
        href="https://www.thisisethos.eu"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
      >
        Powered by Ethos — AI-Use Transparency
        <ExternalLink className="h-3 w-3" />
      </a>
      <p className="text-[10px] text-muted-foreground">
        FLOW is a proprietary analytical framework by Ethos. Learn more at{" "}
        <a
          href="https://www.thisisethos.eu"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          www.thisisethos.eu
        </a>
      </p>
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
            {pillar?.score != null ? Number(pillar.score).toFixed(1) : "—"}
          </p>
          <p className="text-[10px] opacity-70 mt-0.5">/ 5.0</p>
        </div>
      </div>
      <p className="text-xs font-semibold">{scoreLabel}</p>
      <p className="text-sm leading-relaxed opacity-90">{pillar?.narrative ?? ""}</p>
      {(() => {
        const evidence = Array.isArray(pillar?.evidence) ? pillar.evidence : [];
        return evidence.length > 0 ? (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Evidence</p>
            <ul className="text-xs space-y-1 opacity-80">
              {evidence.map((e: string, i: number) => (
                <li key={i} className="flex gap-1.5">
                  <span className="shrink-0 opacity-50">•</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null;
      })()}
      {pillar?.reasoning && (
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
  const legacy = feedback as FlowFeedback;
  return {
    scores: legacy,
    comments: { find: "", lead: "", organize: "", write: "", overall: "" },
  };
}

/** Extract plain FlowFeedback scores from either format */
function extractFeedbackScores(feedback: FlowReport["user_feedback_post"]): FlowFeedback | null {
  if (!feedback) return null;
  if (typeof feedback === "object" && "scores" in feedback) {
    return (feedback as FlowUserAssessment).scores;
  }
  if (typeof feedback === "object" && "find" in feedback) {
    return feedback as FlowFeedback;
  }
  return null;
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
  const [feedbackToggle, setFeedbackToggle] = useState<"pre" | "post">("post");
  const [showHighlighted, setShowHighlighted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showHighlighted) return;

    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      containerRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      const viewport = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null;
      viewport?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [showHighlighted]);
  const [writingContent, setWritingContent] = useState<string>("");

  // Fetch writing content when report loads (needed for highlighted text view)
  const fetchWritingContent = useCallback(async () => {
    if (!report?.project_id) return;
    const { data } = await supabase
      .from("writing_content")
      .select("content")
      .eq("project_id", report.project_id)
      .single();
    if (data) setWritingContent(data.content);
  }, [report?.project_id]);

  useEffect(() => {
    fetchWritingContent();
  }, [fetchWritingContent]);

  useEffect(() => {
    if (!showPreAnalysis) {
      setPreFeedbackViewed(true);
    } else {
      setPreFeedbackViewed(false);
    }
  }, [showPreAnalysis, report?.id]);

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
  const preFeedbackScores = report.user_feedback_pre ?? null;
  const postFeedbackScores = extractFeedbackScores(report.user_feedback_post);
  const hasBothFeedback = preFeedbackScores != null && postFeedbackScores != null;

  // Determine which user feedback to overlay on the radar
  let radarUserFeedback: FlowFeedback | null = null;
  let radarUserLabel = "User Assessment";
  // green for pre, orange for post
  const greenColor = "hsl(142, 71%, 45%)";
  const orangeColor = "hsl(32, 95%, 55%)";
  let radarUserColor = orangeColor;

  if (hasBothFeedback) {
    if (feedbackToggle === "pre") {
      radarUserFeedback = preFeedbackScores;
      radarUserLabel = "Pre-analysis";
      radarUserColor = greenColor;
    } else {
      radarUserFeedback = postFeedbackScores;
      radarUserLabel = "Post-analysis";
      radarUserColor = orangeColor;
    }
  } else if (postFeedbackScores) {
    radarUserFeedback = postFeedbackScores;
    radarUserLabel = "User Assessment";
    radarUserColor = orangeColor;
  } else if (preFeedbackScores) {
    radarUserFeedback = preFeedbackScores;
    radarUserLabel = "User Assessment";
    radarUserColor = greenColor;
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col bg-background h-screen relative overflow-auto">
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

      {/* Highlighted Text Panel (overlays the report) */}
      {showHighlighted && report?.provenance_snapshot && (
        <HighlightedTextErrorBoundary onClose={() => setShowHighlighted(false)}>
          <div className="absolute inset-0 z-10 bg-background">
            <FlowHighlightedText
              segments={report.provenance_snapshot}
              writingContent={writingContent}
              onClose={() => setShowHighlighted(false)}
            />
          </div>
        </HighlightedTextErrorBoundary>
      )}

      {/* Content */}
      <ScrollArea ref={scrollAreaRef} className="flex-1">
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
              {/* Collapsible Info Section */}
              <FlowInfoSection />

              {/* Pre/Post toggle for radar */}
              {hasBothFeedback && (
                <div className="flex items-center justify-center gap-1">
                  <span className="text-xs text-muted-foreground mr-1">Show:</span>
                  <Button
                    variant={feedbackToggle === "pre" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs px-3"
                    onClick={() => setFeedbackToggle("pre")}
                  >
                    Pre-analysis
                  </Button>
                  <Button
                    variant={feedbackToggle === "post" ? "default" : "outline"}
                    size="sm"
                    className="h-7 text-xs px-3"
                    onClick={() => setFeedbackToggle("post")}
                  >
                    Post-analysis
                  </Button>
                </div>
              )}

              {/* Radar Chart */}
              <FlowRadarChart
                report={report}
                userFeedback={radarUserFeedback}
                userLabel={radarUserLabel}
                userColor={radarUserColor}
              />

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

              {/* View Highlighted Text */}
              {report.provenance_snapshot && report.provenance_snapshot.length > 0 && (
                <div className="flex justify-center">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => setShowHighlighted(true)}
                  >
                    <Eye className="h-3.5 w-3.5" />
                    View Highlighted Text
                  </Button>
                </div>
              )}

              {/* Pre-feedback display (if submitted) */}
              {report.user_feedback_pre && (
                <FlowFeedbackSection
                  type="pre"
                  existingFeedback={report.user_feedback_pre}
                  onSubmit={() => {}}
                />
              )}

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
              <div className="text-[10px] text-muted-foreground text-center space-y-0.5">
                <p>
                  Model: {report.model_used} · Generated{" "}
                  {new Date(report.created_at).toLocaleString()}
                </p>
                <p>Project: {projectName}</p>
              </div>

              {/* Report Footer */}
              <FlowReportFooter />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
