import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FlowRadarChart } from "@/components/flow-report/FlowRadarChart";
import { ScoreCard } from "@/components/flow-report/ScoreCard";
import { FlowInfoSection } from "@/components/flow-report/FlowInfoSection";
import { TokenUsageSection } from "@/components/flow-report/TokenUsageSection";
import { ProjectActivitySection } from "@/components/flow-report/ProjectActivitySection";
import { PILLAR_KEYS } from "@/components/flow-report/shared-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Activity, Loader2, ShieldAlert, ExternalLink, Award } from "lucide-react";
import type { FlowReport } from "@/hooks/useFlowAnalysis";

export default function SharedReport() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<FlowReport | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function fetchReport() {
      if (!token) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("flow_reports")
        .select("id, project_id, project_name, certificate_id, share_token, share_enabled, share_visibility, model_used, created_at, ai_find, ai_lead, ai_organize, ai_write, ai_summary, flow_meta, metrics_snapshot")
        .eq("share_token", token)
        .eq("share_enabled", true)
        .eq("share_visibility", "public")
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      setReport(data as unknown as FlowReport);
      setProjectName((data as any).project_name ?? "Untitled Project");
      setLoading(false);
    }

    fetchReport();
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Loading report…</p>
        </div>
      </div>
    );
  }

  if (notFound || !report) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-md px-6">
          <ShieldAlert className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold text-foreground">Report not available</h1>
          <p className="text-sm text-muted-foreground">
            This FLOW report is either not shared, has been disabled, or doesn't exist.
          </p>
          <a
            href="https://www.thisisethos.eu"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80"
          >
            Learn about Ethos
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>
    );
  }

  const certificateId = (report as any).certificate_id;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="h-14 border-b border-border flex items-center justify-between px-6 bg-[hsl(var(--ethos-surface))]">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Activity className="h-4 w-4" />
          FLOW Report
        </div>
        <span className="text-xs text-muted-foreground">{projectName}</span>
      </div>

      {/* Certificate Banner */}
      {certificateId && (
        <div className="border-b border-border bg-primary/5 py-3 px-6 flex items-center justify-center gap-2">
          <Award className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-primary">FLOW Certificate #{certificateId}</span>
        </div>
      )}

      <ScrollArea className="h-[calc(100vh-3.5rem)]">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
          <FlowInfoSection />

          <FlowRadarChart
            report={report}
            userFeedback={null}
            userLabel=""
            userColor=""
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {PILLAR_KEYS.map((key) => (
              <ScoreCard
                key={key}
                pillarKey={key}
                pillar={report[`ai_${key}` as keyof FlowReport] as any}
              />
            ))}
          </div>

          {/* Overall Summary */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Overall Summary</h4>
            <div className="bg-muted/50 rounded-lg p-5">
              <p className="text-sm text-foreground leading-relaxed">{report.ai_summary}</p>
            </div>
          </div>

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

          {/* Ethos Footer */}
          <div className="border-t border-border pt-6 pb-8 mt-8 text-center space-y-3">
            <p className="text-sm font-medium text-foreground">
              This report was generated by{" "}
              <a
                href="https://www.thisisethos.eu"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary/80 underline underline-offset-2"
              >
                Ethos
              </a>
              {" "}— FLOW Analysed
            </p>
            {certificateId && (
              <p className="text-xs text-muted-foreground">Certificate: {certificateId}</p>
            )}
            <a
              href="https://www.thisisethos.eu"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80"
            >
              Learn more at www.thisisethos.eu
              <ExternalLink className="h-3 w-3" />
            </a>
            <p className="text-[10px] text-muted-foreground">
              FLOW is a proprietary analytical framework by Ethos.
            </p>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
