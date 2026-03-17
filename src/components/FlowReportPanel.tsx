import { useEffect } from "react";
import { Activity, Clock, Pencil, MessageSquare, Shield, Zap, AlertTriangle, CheckCircle, AlertOctagon, Loader2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFlowAnalysis, type FlowReport, type FlowPillar } from "@/hooks/useFlowAnalysis";
import { FlowTokenWarningDialog } from "@/components/FlowTokenWarningDialog";
import { useState } from "react";

interface Props {
  projectId: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function PillarCard({ label, pillar }: { label: string; pillar: FlowPillar }) {
  const scoreDisplay =
    pillar.score != null ? pillar.score.toFixed(1) : "N/A";
  const scoreColor =
    pillar.score == null
      ? "text-muted-foreground"
      : pillar.score >= 4
      ? "text-green-500"
      : pillar.score >= 2.5
      ? "text-yellow-500"
      : "text-destructive";

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-sm">{label}</h4>
        <span className={`text-lg font-bold ${scoreColor}`}>{scoreDisplay}</span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{pillar.narrative}</p>
      {pillar.evidence.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">Evidence ({pillar.evidence.length})</summary>
          <ul className="mt-1 space-y-1 pl-3">
            {pillar.evidence.map((e, i) => (
              <li key={i} className="list-disc">{e}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TokenUsageSection({ flowMeta }: { flowMeta: NonNullable<FlowReport["flow_meta"]> }) {
  const ratio = flowMeta.estimated_input_tokens / flowMeta.context_limit_tokens;
  const pct = Math.round(ratio * 100);
  const status = flowMeta.token_status;
  const StatusIcon = status === "over" ? AlertOctagon : status === "near" ? AlertTriangle : CheckCircle;
  const statusLabel = status === "over" ? "Over Limit" : status === "near" ? "Near Limit" : "OK";
  const statusColor = status === "over" ? "text-destructive" : status === "near" ? "text-yellow-500" : "text-green-500";

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <h4 className="font-semibold text-sm flex items-center gap-1.5">
        <Zap className="h-3.5 w-3.5 text-muted-foreground" />
        Token Usage
      </h4>
      <div className="grid grid-cols-2 gap-y-1.5 text-xs">
        <span className="text-muted-foreground">Estimated prompt tokens</span>
        <span className="text-right font-medium">{flowMeta.estimated_input_tokens.toLocaleString()}</span>
        <span className="text-muted-foreground">Context limit</span>
        <span className="text-right font-medium">{flowMeta.context_limit_tokens.toLocaleString()}</span>
        <span className="text-muted-foreground">Usage</span>
        <span className="text-right font-medium">{pct}%</span>
        <span className="text-muted-foreground">Status</span>
        <span className={`text-right font-semibold flex items-center justify-end gap-1 ${statusColor}`}>
          <StatusIcon className="h-3 w-3" />
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

function ProjectActivitySection({ metrics }: { metrics: NonNullable<FlowReport["metrics_snapshot"]> }) {
  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <h4 className="font-semibold text-sm flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        Project Activity (at analysis time)
      </h4>
      <div className="grid grid-cols-2 gap-y-1.5 text-xs">
        <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Active time</span>
        <span className="text-right font-medium">{formatDuration(metrics.total_active_time_seconds)}</span>
        <span className="text-muted-foreground flex items-center gap-1"><Pencil className="h-3 w-3" /> Writing time</span>
        <span className="text-right font-medium">{formatDuration(metrics.total_writing_time_seconds)}</span>
        <span className="text-muted-foreground flex items-center gap-1"><MessageSquare className="h-3 w-3" /> Chat prompts</span>
        <span className="text-right font-medium">{metrics.chat_prompt_count_normal + metrics.chat_prompt_count_tutor}</span>
        <span className="text-muted-foreground flex items-center gap-1"><Shield className="h-3 w-3" /> Sanity checks</span>
        <span className="text-right font-medium">{metrics.sanity_check_count}</span>
      </div>
    </div>
  );
}

export function FlowReportPanel({ projectId }: Props) {
  const {
    preCheck,
    runPreCheck,
    clearPreCheck,
    loading,
    report,
    error,
    budgetError,
    runAnalysis,
    loadLatestReport,
  } = useFlowAnalysis(projectId);

  const [showWarning, setShowWarning] = useState(false);

  useEffect(() => {
    loadLatestReport();
  }, [loadLatestReport]);

  const handleRunClick = async () => {
    const estimation = await runPreCheck();
    if (!estimation) return;
    if (estimation.status === "ok") {
      // Safe — proceed directly
      runAnalysis();
    } else {
      // Show warning modal
      setShowWarning(true);
    }
  };

  const handleConfirm = () => {
    setShowWarning(false);
    clearPreCheck();
    runAnalysis();
  };

  const handleCancel = () => {
    setShowWarning(false);
    clearPreCheck();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Activity className="h-4 w-4 text-primary" />
          FLOW Analysis
        </h3>
        <Button size="sm" onClick={handleRunClick} disabled={loading}>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          {loading ? "Analyzing…" : report ? "Re-run Analysis" : "Run Analysis"}
        </Button>
      </div>

      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {budgetError && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 space-y-1">
          <p>Insufficient token budget</p>
          <p className="text-xs text-muted-foreground">
            Estimated cost: ~{budgetError.estimated_cost.toLocaleString()} tokens •
            Remaining: {budgetError.budget_remaining.toLocaleString()} tokens
          </p>
        </div>
      )}

      {report && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm text-foreground leading-relaxed">{report.ai_summary}</p>
          </div>

          {/* Pillars */}
          <div className="grid gap-3">
            <PillarCard label="F — Find (Research & Critical Thinking)" pillar={report.ai_find} />
            <PillarCard label="L — Lead (Ideas & Opinions)" pillar={report.ai_lead} />
            <PillarCard label="O — Organize (Structure & Argumentation)" pillar={report.ai_organize} />
            <PillarCard label="W — Write (Writing & Text Production)" pillar={report.ai_write} />
          </div>

          {/* Token Usage — only if flow_meta exists */}
          {report.flow_meta && <TokenUsageSection flowMeta={report.flow_meta} />}

          {/* Project Activity — only if metrics_snapshot exists */}
          {report.metrics_snapshot && <ProjectActivitySection metrics={report.metrics_snapshot} />}

          <p className="text-[10px] text-muted-foreground text-right">
            Model: {report.model_used} • {new Date(report.created_at).toLocaleString()}
          </p>
        </div>
      )}

      <FlowTokenWarningDialog
        open={showWarning}
        estimation={preCheck}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}
