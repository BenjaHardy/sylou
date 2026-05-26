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
import sylouLogo from "@/assets/sylou-logo.png";
import { PUBLIC_SITE_URL } from "@/lib/site";
import { FlowHighlightedText } from "@/components/FlowHighlightedText";
import { FlowReplayOverlay, type ReplayEvent } from "@/components/FlowReplayOverlay";
import { QRCodeSVG } from "qrcode.react";
import { MODEL_LABELS } from "@/lib/models";
import { FlowPledgeBadge } from "@/components/flow-report/FlowPledgeBadge";
import {
  ArrowLeft,
  Activity,
  Eye,
  Play,
  Loader2,
  Info,
  Share2,
  Copy,
  Check,
  Award,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FlowFeedbackSection } from "@/components/FlowFeedbackSection";
import { FlowUserAssessmentSection } from "@/components/FlowUserAssessmentSection";

// Extracted sub-components
import { FlowRadarChart } from "@/components/flow-report/FlowRadarChart";
import { ScoreCard } from "@/components/flow-report/ScoreCard";
import { FlowInfoSection } from "@/components/flow-report/FlowInfoSection";
import { FlowReportFooter } from "@/components/flow-report/FlowReportFooter";
import { TokenUsageSection } from "@/components/flow-report/TokenUsageSection";
import { ProjectActivitySection } from "@/components/flow-report/ProjectActivitySection";
import { extractUserAssessment, extractFeedbackScores } from "@/components/flow-report/shared-utils";
import FlowWorkProfile from "@/components/FlowWorkProfile";
import { ProfileTabContent } from "@/components/flow-report/ProfileTabContent";
import { WritingSnapshotTab } from "@/components/flow-report/WritingSnapshotTab";
import { KeyUserContributions } from "@/components/flow-report/KeyUserContributions";
import { getFlowProfile } from "@/lib/flow-work-profiles";

import type {
  FlowReport,
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
  showPreAnalysis: boolean;
}

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
  const [activeTab, setActiveTab] = useState<"report" | "writing" | "profile" | "replay">("report");
  const [showHighlighted, setShowHighlighted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // Sharing state
  const [sharing, setSharing] = useState(false);
  const [shareToken, setShareToken] = useState<string | null>(report?.share_token ?? null);
  const [certificateId, setCertificateId] = useState<string | null>(report?.certificate_id ?? null);
  const [shareEnabled, setShareEnabled] = useState<boolean>(report?.share_enabled ?? false);
  const [copied, setCopied] = useState(false);
  const [shareIncludeFeedback, setShareIncludeFeedback] = useState<boolean>(report?.share_include_feedback ?? false);
  const [shareIncludeReplay, setShareIncludeReplay] = useState<boolean>((report as any)?.share_include_replay ?? false);
  const [shareIncludeReport, setShareIncludeReport] = useState<boolean>((report as any)?.share_include_report ?? true);
  const [shareIncludeProfile, setShareIncludeProfile] = useState<boolean>((report as any)?.share_include_profile ?? true);

  // Replay state
  const [showReplay, setShowReplay] = useState(false);
  const [replaySnapshot, setReplaySnapshot] = useState<ReplayEvent[] | null>(null);
  const [loadingReplay, setLoadingReplay] = useState(false);

  // Sync sharing state when report changes
  useEffect(() => {
    if (report) {
      setShareToken(report.share_token ?? null);
      setCertificateId(report.certificate_id ?? null);
      setShareEnabled(report.share_enabled ?? false);
      setShareIncludeFeedback(report.share_include_feedback ?? false);
      setShareIncludeReplay((report as any).share_include_replay ?? false);
      setShareIncludeReport((report as any).share_include_report ?? true);
      setShareIncludeProfile((report as any).share_include_profile ?? true);
    }
  }, [report?.id, report?.share_token, report?.share_enabled, report?.certificate_id, report?.share_include_feedback]);

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

  // Share handlers
  const handleShare = async () => {
    if (!report) return;
    setSharing(true);
    try {
      const { data, error } = await supabase.functions.invoke("share-report", {
        body: { report_id: report.id },
      });
      if (error) throw error;
      setShareToken(data.share_token);
      setCertificateId(data.certificate_id);
      setShareEnabled(true);
    } catch (err) {
      console.error("Failed to share report:", err);
    } finally {
      setSharing(false);
    }
  };

  const handleToggleShare = async (enabled: boolean) => {
    if (!report) return;
    setSharing(true);
    try {
      const { error } = await supabase.functions.invoke("share-report", {
        body: { report_id: report.id, action: "toggle", share_enabled: enabled },
      });
      if (error) throw error;
      setShareEnabled(enabled);
    } catch (err) {
      console.error("Failed to toggle sharing:", err);
    } finally {
      setSharing(false);
    }
  };

  const shareUrl = shareToken ? `${PUBLIC_SITE_URL}/report/${shareToken}` : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLoadReplay = useCallback(async () => {
    if (!report) return;
    if (replaySnapshot) return;
    setLoadingReplay(true);
    try {
      const { data } = await supabase
        .from("flow_reports")
        .select("replay_snapshot")
        .eq("id", report.id)
        .single();
      if (data?.replay_snapshot) {
        setReplaySnapshot(data.replay_snapshot as unknown as ReplayEvent[]);
      }
    } catch (err) {
      console.error("Failed to load replay:", err);
    } finally {
      setLoadingReplay(false);
    }
  }, [report, replaySnapshot]);

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

  const flowScores = {
    find: (report.ai_find as any)?.score ?? null,
    lead: (report.ai_lead as any)?.score ?? null,
    organize: (report.ai_organize as any)?.score ?? null,
    write: (report.ai_write as any)?.score ?? null,
  };
  const flowProfile = getFlowProfile(flowScores);

  const existingAssessment = extractUserAssessment(report.user_feedback_post);
  const preFeedbackScores = report.user_feedback_pre ?? null;
  const postFeedbackScores = extractFeedbackScores(report.user_feedback_post);
  const hasBothFeedback = preFeedbackScores != null && postFeedbackScores != null;

  let radarUserFeedback: FlowFeedback | null = null;
  let radarUserLabel = "User Assessment";
  const greenColor = "hsl(142, 71%, 45%)";
  const orangeColor = "hsl(32, 95%, 55%)";
  let radarUserColor = orangeColor;

  if (hasBothFeedback) {
    if (feedbackToggle === "pre") {
      radarUserFeedback = preFeedbackScores;
      radarUserLabel = "Pre-analysis (user assessment)";
      radarUserColor = greenColor;
    } else {
      radarUserFeedback = postFeedbackScores;
      radarUserLabel = "Post-analysis (user assessment)";
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

      {/* Highlighted Text Panel */}
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

      {/* (Replay rendered inline inside Replay tab below) */}

      {/* Content */}
      <ScrollArea ref={scrollAreaRef} className="flex-1">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
          {/* Sylou logo */}
          <div className="flex justify-center">
            <img src={sylouLogo} alt="Sylou" className="h-12" />
          </div>
          {/* Tab Switcher */}
          <div className="flex items-center justify-center gap-1">
            <Button
              variant={activeTab === "report" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setActiveTab("report")}
            >
              FLOW Report
            </Button>
            <Button
              variant={activeTab === "profile" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setActiveTab("profile")}
            >
              FLOW Profile
            </Button>
            <Button
              variant={activeTab === "replay" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3 gap-1"
              onClick={() => {
                setActiveTab("replay");
                if (!replaySnapshot) handleLoadReplay();
              }}
              title={undefined}
            >
              <Play className="h-3 w-3" />
              Replay
            </Button>
            <Button
              variant={activeTab === "writing" ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs px-3"
              onClick={() => setActiveTab("writing")}
            >
              Writing
            </Button>
          </div>

          {/* FLOW Profile Tab */}
          {activeTab === "profile" && (
            <div key="profile" className="animate-card-flip">
              <ProfileTabContent
                aiScores={flowScores}
                preFeedbackScores={preFeedbackScores}
                postAssessment={existingAssessment}
                flowMeta={report.flow_meta}
                metricsSnapshot={report.metrics_snapshot}
              />
            </div>
          )}

          {/* Writing Snapshot Tab */}
          {activeTab === "writing" && (
            <div key="writing" className="animate-card-flip">
              <WritingSnapshotTab
                snapshot={(report as any)?.writing_snapshot ?? ""}
                capturedAt={report?.created_at}
              />
            </div>
          )}

          {/* Replay Tab */}
          {activeTab === "replay" && (
            <div key="replay" className="animate-card-flip">
              {loadingReplay ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : replaySnapshot ? (
                <div className="border border-border rounded-lg overflow-hidden h-[70vh]">
                  <FlowReplayOverlay events={replaySnapshot} onClose={() => setActiveTab("report")} />
                </div>
              ) : (
                <div className="text-center py-16 space-y-3">
                  <p className="text-sm text-muted-foreground">No replay data available for this report.</p>
                  <Button variant="outline" size="sm" onClick={handleLoadReplay}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* FLOW Report Tab */}
          {activeTab === "report" && (
            <>
          {/* Pre-feedback */}
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
              {/* Sharing Controls */}
              <div className="border border-border rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <Share2 className="h-3.5 w-3.5" />
                    Share Report
                  </h4>
                  {shareToken ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {shareEnabled ? "Sharing enabled" : "Sharing disabled"}
                      </span>
                      <Switch
                        checked={shareEnabled}
                        onCheckedChange={handleToggleShare}
                        disabled={sharing}
                      />
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-xs"
                      onClick={handleShare}
                      disabled={sharing}
                    >
                      {sharing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Share2 className="h-3 w-3" />
                      )}
                      Generate Share Link
                    </Button>
                  )}
                </div>

                {shareToken && shareEnabled && (
                  <div className="space-y-3">
                    {/* Certificate ID */}
                    {certificateId && (
                      <div className="flex items-center gap-2 text-xs">
                        <Award className="h-3.5 w-3.5 text-primary" />
                        <span className="font-medium text-foreground">FLOW Certificate #{certificateId}</span>
                      </div>
                    )}

                    {/* Sections to include (at least one required) */}
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Sections to include</p>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="share-include-report"
                          checked={shareIncludeReport}
                          onCheckedChange={async (checked) => {
                            const val = checked === true;
                            // Prevent unchecking the last selected section
                            if (!val && !shareIncludeProfile) return;
                            setShareIncludeReport(val);
                            try {
                              await supabase.functions.invoke("share-report", {
                                body: { report_id: report.id, action: "toggle", share_include_report: val },
                              });
                            } catch (err) {
                              console.error("Failed to update report visibility:", err);
                              setShareIncludeReport(!val);
                            }
                          }}
                        />
                        <label htmlFor="share-include-report" className="text-xs text-muted-foreground cursor-pointer">
                          FLOW Report
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="share-include-profile"
                          checked={shareIncludeProfile}
                          onCheckedChange={async (checked) => {
                            const val = checked === true;
                            if (!val && !shareIncludeReport) return;
                            setShareIncludeProfile(val);
                            try {
                              await supabase.functions.invoke("share-report", {
                                body: { report_id: report.id, action: "toggle", share_include_profile: val },
                              });
                            } catch (err) {
                              console.error("Failed to update profile visibility:", err);
                              setShareIncludeProfile(!val);
                            }
                          }}
                        />
                        <label htmlFor="share-include-profile" className="text-xs text-muted-foreground cursor-pointer">
                          FLOW Profile
                        </label>
                      </div>
                    </div>

                    <p className="text-[10px] text-muted-foreground italic leading-relaxed">
                      The writing snapshot is always included in shared reports so reviewers can see the work that was assessed.
                    </p>

                    {/* Include feedback checkbox */}
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="share-include-feedback"
                        checked={shareIncludeFeedback}
                        onCheckedChange={async (checked) => {
                          const val = checked === true;
                          setShareIncludeFeedback(val);
                          try {
                            await supabase.functions.invoke("share-report", {
                              body: { report_id: report.id, action: "toggle", share_include_feedback: val },
                            });
                          } catch (err) {
                            console.error("Failed to update feedback visibility:", err);
                            setShareIncludeFeedback(!val);
                          }
                        }}
                      />
                      <label htmlFor="share-include-feedback" className="text-xs text-muted-foreground cursor-pointer">
                        Include my self-assessment in shared report
                      </label>
                    </div>

                    {/* Include replay checkbox */}
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="share-include-replay"
                        checked={shareIncludeReplay}
                        onCheckedChange={async (checked) => {
                          const val = checked === true;
                          setShareIncludeReplay(val);
                          try {
                            await supabase.functions.invoke("share-report", {
                              body: { report_id: report.id, action: "toggle", share_include_replay: val },
                            });
                          } catch (err) {
                            console.error("Failed to update replay visibility:", err);
                            setShareIncludeReplay(!val);
                          }
                        }}
                      />
                      <label htmlFor="share-include-replay" className="text-xs text-muted-foreground cursor-pointer">
                        Include project replay in shared report
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={shareUrl}
                        className="flex-1 text-xs bg-muted/50 border border-border rounded-md px-3 py-2 text-foreground"
                      />
                      <Button variant="outline" size="sm" className="gap-1 text-xs shrink-0" onClick={handleCopy}>
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied ? "Copied" : "Copy"}
                      </Button>
                    </div>




                    {/* Pledge Badges */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-muted-foreground">FLOW Pledge Badge (Radar Chart)</span>
                        <FlowPledgeBadge
                          variant="radar"
                          aiScores={{
                            find: report.ai_find?.score ?? null,
                            lead: report.ai_lead?.score ?? null,
                            organize: report.ai_organize?.score ?? null,
                            write: report.ai_write?.score ?? null,
                          }}
                          certificateId={certificateId || ""}
                          shareUrl={shareUrl}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <span className="text-xs text-muted-foreground">FLOW Pledge Badge (Profile)</span>
                        <FlowPledgeBadge
                          variant="profile"
                          profile={{
                            code: flowProfile.code,
                            name: flowProfile.name,
                            tagline: flowProfile.tagline,
                          }}
                          aiScores={{
                            find: report.ai_find?.score ?? null,
                            lead: report.ai_lead?.score ?? null,
                            organize: report.ai_organize?.score ?? null,
                            write: report.ai_write?.score ?? null,
                          }}
                          certificateId={certificateId || ""}
                          shareUrl={shareUrl}
                        />
                      </div>
                    </div>

                  </div>
                )}
              </div>

              {/* Info Section */}
              <FlowInfoSection />

              {/* Pre/Post toggle */}
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

              {/* Key User Contributions */}
              <KeyUserContributions contributions={(report as any).key_user_contributions} />

              {/* View Highlighted Text */}
              {report.provenance_snapshot && report.provenance_snapshot.length > 0 && (
                <div className="flex justify-center gap-2">
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

              {/* Pre-feedback display */}
              {report.user_feedback_pre && (
                <FlowFeedbackSection
                  type="pre"
                  existingFeedback={report.user_feedback_pre}
                  onSubmit={() => {}}
                />
              )}

              {/* User Assessment */}
              <FlowUserAssessmentSection
                existingAssessment={existingAssessment}
                onSubmit={onSaveAssessment}
              />

              {/* Token Usage */}
              {report.flow_meta && <TokenUsageSection meta={report.flow_meta} />}

              {/* Imported Documents Notices */}
              {report.flow_meta?.imported_documents_mode === "summaries" && (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>Imported documents were included as summaries due to context length limits.</span>
                </div>
              )}
              {report.flow_meta?.imported_documents_mode === "excluded" && (
                <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>Imported documents ({report.flow_meta.imported_documents_count}) were excluded from this analysis due to context length limits.</span>
                </div>
              )}

              {/* Project Activity */}
              {report.metrics_snapshot && <ProjectActivitySection metrics={report.metrics_snapshot} />}

              {/* Metadata footer */}
              <div className="text-[10px] text-muted-foreground text-center space-y-0.5">
                <p>
                  Model: {MODEL_LABELS[report.model_used] ?? report.model_used} · Generated{" "}
                  {new Date(report.created_at).toLocaleString()}
                </p>
                <p>Project: {projectName}</p>
              </div>

              {/* Report Footer */}
              <FlowReportFooter />
            </>
          )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
