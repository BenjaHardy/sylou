import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { FlowRadarChart } from "@/components/flow-report/FlowRadarChart";
import { ScoreCard } from "@/components/flow-report/ScoreCard";
import { FlowInfoSection } from "@/components/flow-report/FlowInfoSection";
import { TokenUsageSection } from "@/components/flow-report/TokenUsageSection";
import { ProjectActivitySection } from "@/components/flow-report/ProjectActivitySection";
import { FlowReplayOverlay, type ReplayEvent } from "@/components/FlowReplayOverlay";
import { ProfileTabContent } from "@/components/flow-report/ProfileTabContent";
import { KeyUserContributions } from "@/components/flow-report/KeyUserContributions";
import { SelfAssessmentDisplay } from "@/components/flow-report/SelfAssessmentDisplay";
import {
  PILLAR_KEYS,
  extractUserAssessment,
  extractFeedbackScores,
} from "@/components/flow-report/shared-utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Activity, Loader2, ShieldAlert, ExternalLink, Award, Play } from "lucide-react";
import type { FlowReport, FlowFeedback } from "@/hooks/useFlowAnalysis";

export default function SharedReport() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<FlowReport | null>(null);
  const [projectName, setProjectName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Replay state
  const [replaySnapshot, setReplaySnapshot] = useState<ReplayEvent[] | null>(null);
  const [loadingReplay, setLoadingReplay] = useState(false);
  const [replayAvailable, setReplayAvailable] = useState(false);
  const [reportAvailable, setReportAvailable] = useState(true);
  const [profileAvailable, setProfileAvailable] = useState(true);
  const [activeTab, setActiveTab] = useState<"report" | "profile" | "replay">("report");

  useEffect(() => {
    async function fetchReport() {
      if (!token) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("flow_reports")
        .select("id, project_id, project_name, certificate_id, share_token, share_enabled, share_visibility, share_include_feedback, share_include_replay, share_include_report, share_include_profile, model_used, created_at, ai_find, ai_lead, ai_organize, ai_write, ai_summary, key_user_contributions, flow_meta, metrics_snapshot, user_feedback_pre, user_feedback_post")
        .eq("share_token", token)
        .eq("share_enabled", true)
        .eq("share_visibility", "public")
        .maybeSingle();

      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      const row = data as any;
      // Default to true for backwards compatibility
      const includeReport = row.share_include_report ?? true;
      const includeProfile = row.share_include_profile ?? true;
      const includeReplay = !!row.share_include_replay;

      setReport(data as unknown as FlowReport);
      setProjectName(row.project_name ?? "Untitled Project");
      setReplayAvailable(includeReplay);
      setReportAvailable(includeReport);
      setProfileAvailable(includeProfile);

      // Default tab: Report if shared, else Profile, else Replay
      if (includeReport) setActiveTab("report");
      else if (includeProfile) setActiveTab("profile");
      else if (includeReplay) setActiveTab("replay");

      setLoading(false);
    }

    fetchReport();
  }, [token]);

  const handleLoadReplay = useCallback(async () => {
    if (!report || !token || replaySnapshot) return;
    setLoadingReplay(true);
    try {
      const { data } = await supabase
        .from("flow_reports")
        .select("replay_snapshot")
        .eq("share_token", token)
        .eq("share_enabled", true)
        .eq("share_include_replay", true)
        .maybeSingle();
      if (data?.replay_snapshot) {
        setReplaySnapshot(data.replay_snapshot as unknown as ReplayEvent[]);
      }
    } catch (err) {
      console.error("Failed to load replay:", err);
    } finally {
      setLoadingReplay(false);
    }
  }, [report, token, replaySnapshot]);

  // Auto-load replay when replay tab opened
  useEffect(() => {
    if (activeTab === "replay" && !replaySnapshot && !loadingReplay) {
      handleLoadReplay();
    }
  }, [activeTab, replaySnapshot, loadingReplay, handleLoadReplay]);

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

  const flowScores = {
    find: (report.ai_find as any)?.score ?? null,
    lead: (report.ai_lead as any)?.score ?? null,
    organize: (report.ai_organize as any)?.score ?? null,
    write: (report.ai_write as any)?.score ?? null,
  };

  const certificateId = (report as any).certificate_id;
  const showFeedback = !!(report as any).share_include_feedback;
  const preFeedbackScores: FlowFeedback | null = showFeedback ? (report.user_feedback_pre ?? null) : null;
  const postAssessment = showFeedback ? extractUserAssessment(report.user_feedback_post) : null;
  const postFeedbackScores = showFeedback ? extractFeedbackScores(report.user_feedback_post) : null;

  let radarUserFeedback: FlowFeedback | null = null;
  let radarUserLabel = "";
  let radarUserColor = "";
  if (showFeedback) {
    if (postFeedbackScores) {
      radarUserFeedback = postFeedbackScores;
      radarUserLabel = "User Assessment";
      radarUserColor = "hsl(32, 95%, 55%)";
    } else if (preFeedbackScores) {
      radarUserFeedback = preFeedbackScores;
      radarUserLabel = "User Assessment";
      radarUserColor = "hsl(142, 71%, 45%)";
    }
  }

  // Visible tabs count (more than one means show switcher)
  const visibleTabsCount = (reportAvailable ? 1 : 0) + (profileAvailable ? 1 : 0) + (replayAvailable ? 1 : 0);

  return (
    <div className="min-h-screen bg-background relative">
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
          {/* Tab Switcher (only if multiple tabs visible) */}
          {visibleTabsCount > 1 && (
            <div className="flex items-center justify-center gap-1">
              {reportAvailable && (
                <Button
                  variant={activeTab === "report" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-3"
                  onClick={() => setActiveTab("report")}
                >
                  FLOW Report
                </Button>
              )}
              {profileAvailable && (
                <Button
                  variant={activeTab === "profile" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-3"
                  onClick={() => setActiveTab("profile")}
                >
                  FLOW Profile
                </Button>
              )}
              {replayAvailable && (
                <Button
                  variant={activeTab === "replay" ? "default" : "outline"}
                  size="sm"
                  className="h-7 text-xs px-3 gap-1"
                  onClick={() => setActiveTab("replay")}
                >
                  <Play className="h-3 w-3" />
                  Replay
                </Button>
              )}
            </div>
          )}

          {/* FLOW Profile Tab */}
          {activeTab === "profile" && profileAvailable && (
            <div key="profile" className="animate-card-flip">
              <ProfileTabContent
                aiScores={flowScores}
                preFeedbackScores={preFeedbackScores}
                postAssessment={postAssessment}
                showSelfAssessment={showFeedback}
              />
            </div>
          )}

          {/* Replay Tab */}
          {activeTab === "replay" && replayAvailable && (
            <div key="replay" className="animate-card-flip">
              {loadingReplay ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : replaySnapshot ? (
                <div className="border border-border rounded-lg overflow-hidden h-[70vh]">
                  <FlowReplayOverlay events={replaySnapshot} onClose={() => {
                    if (reportAvailable) setActiveTab("report");
                    else if (profileAvailable) setActiveTab("profile");
                  }} sanitize />
                </div>
              ) : (
                <div className="text-center py-16 space-y-3">
                  <p className="text-sm text-muted-foreground">No replay data available.</p>
                </div>
              )}
            </div>
          )}

          {/* FLOW Report Tab */}
          {activeTab === "report" && reportAvailable && (
            <>
              <FlowInfoSection />

              <FlowRadarChart
                report={report}
                userFeedback={radarUserFeedback}
                userLabel={radarUserLabel}
                userColor={radarUserColor}
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

              {/* Key User Contributions */}
              <KeyUserContributions contributions={(report as any).key_user_contributions} />

              {/* User Self-Assessment (read-only) */}
              {showFeedback && (
                <SelfAssessmentDisplay
                  preFeedbackScores={preFeedbackScores}
                  postAssessment={postAssessment}
                />
              )}

              {/* Token Usage */}
              {report.flow_meta && <TokenUsageSection meta={report.flow_meta} />}

              {/* Project Activity */}
              {report.metrics_snapshot && <ProjectActivitySection metrics={report.metrics_snapshot} />}
            </>
          )}

          {/* Metadata footer (always shown) */}
          <div className="text-[10px] text-muted-foreground text-center space-y-0.5">
            <p>
              Model: {report.model_used} · Generated{" "}
              {new Date(report.created_at).toLocaleString()}
            </p>
            <p>Project: {projectName}</p>
          </div>

          {/* Ethos Footer (always shown) */}
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
