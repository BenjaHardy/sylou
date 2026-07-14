import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { estimateTokens, classifyTokenUsage, type TokenEstimation } from "@/lib/estimateTokens";
import { useUserSettings } from "@/hooks/useUserSettings";
import type { Json } from "@/integrations/supabase/types";

export interface FlowPillar {
  reasoning: string;
  evidence: string[];
  score: number | null;
  narrative: string;
}

export interface FlowMeta {
  estimated_input_tokens: number;
  context_limit_tokens: number;
  token_status: string;
  measured_at: string;
  similarity_pct?: number;
  write_score_capped?: boolean;
  imported_documents_mode?: "full_text" | "summaries" | "excluded" | "none";
  imported_documents_count?: number;
  imported_documents_total_chars?: number;
  /**
   * Temperature actually sent to the LLM for this analysis.
   * `null` = the provider controls it (e.g. Claude Opus 4.7+ rejects any
   * non-default value with HTTP 400, so we omit the field).
   * A number = we explicitly requested that value (typically 0.0 for FLOW).
   */
  temperature_used?: number | null;
  /**
   * Reasoning disclosure (provider-agnostic). All three fields are
   * `undefined` on legacy reports written before disclosure shipped.
   * `null` on current reports means the field does not apply to this
   * provider (e.g. `reasoning_thinking` is `null` for Mistral).
   */
  reasoning_provider?: string | null;
  reasoning_thinking?: boolean | null;
  reasoning_effort?: string | null;
  /**
   * Engineering-standards §5 disclosure. `repaired_pillars`: pillar keys
   * whose stringified JSON the repair layer re-parsed before validation,
   * plus "<pillar>.score" entries for numeric-string scores coerced to
   * numbers. `defaulted_sections`: sections ("find"/"lead"/"organize"/
   * "write"/"summary") replaced with a "Could not be assessed" default,
   * plus "<pillar>.score" entries for invalid scores nulled by validation.
   * Empty arrays on a clean run; `undefined` on reports from before
   * disclosure shipped. Not yet surfaced in the report UI.
   */
  repaired_pillars?: string[];
  defaulted_sections?: string[];
}

export interface MetricsSnapshot {
  total_active_time_seconds: number;
  total_writing_time_seconds: number;
  chat_prompt_count_normal: number;
  chat_prompt_count_tutor: number;
  sanity_check_count: number;
  first_activity_at: string | null;
  last_activity_at: string | null;
  clock_anomaly_count: number;
}

export interface FlowFeedback {
  find: number | null;
  lead: number | null;
  organize: number | null;
  write: number | null;
}

export interface FlowUserAssessment {
  scores: FlowFeedback;
  comments: {
    find: string;
    lead: string;
    organize: string;
    write: string;
    overall: string;
  };
}

export interface KeyUserContribution {
  contribution: string;
  evidence: string;
  why_it_matters: string;
}

/**
 * Origin/provenance metadata stamped onto a report by the generating
 * instance. Structurally mirrors FlowPledgeBadge's `BadgeGeneratorInfo`
 * (kept assignable to it so it can pass straight to the badge's
 * `generatorInfo` prop).
 */
export interface GeneratorInfo {
  instance_label?: string;
  instance_domain?: string | null;
  version?: string;
  commit_hash?: string;
  is_modified?: boolean;
}

export interface FlowReport {
  id: string;
  project_id: string;
  ai_summary: string;
  ai_find: FlowPillar;
  ai_lead: FlowPillar;
  ai_organize: FlowPillar;
  ai_write: FlowPillar;
  key_user_contributions: KeyUserContribution[] | null;
  flow_meta: FlowMeta | null;
  metrics_snapshot: MetricsSnapshot | null;
  provenance_snapshot: import("@/lib/provenance-tracker").ProvenanceSegment[] | null;
  model_used: string;
  created_at: string;
  user_feedback_pre: FlowFeedback | null;
  user_feedback_pre_at: string | null;
  user_feedback_post: FlowUserAssessment | FlowFeedback | null;
  user_feedback_post_at: string | null;
  share_token?: string | null;
  share_enabled?: boolean | null;
  certificate_id?: string | null;
  share_visibility?: string | null;
  project_name?: string | null;
  share_include_feedback?: boolean;
  share_include_replay?: boolean;
  writing_snapshot?: string | null;
  generator_info?: GeneratorInfo | null;
}

export interface BudgetError {
  type: "budget";
  estimated_cost: number;
  budget_remaining: number;
  message: string;
}

export function useFlowAnalysis(projectId: string | null) {
  const { settings } = useUserSettings();
  const [preCheck, setPreCheck] = useState<TokenEstimation | null>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<FlowReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<BudgetError | null>(null);
  /** Whether a report existed before the user first clicked "Analyze with FLOW" in this session */
  const [hadReportOnMount, setHadReportOnMount] = useState<boolean | null>(null);

  /** Load the latest existing flow report for this project */
  const loadLatestReport = useCallback(async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from("flow_reports")
      .select("id, project_id, ai_summary, ai_find, ai_lead, ai_organize, ai_write, key_user_contributions, flow_meta, metrics_snapshot, provenance_snapshot, writing_snapshot, model_used, created_at, user_feedback_pre, user_feedback_pre_at, user_feedback_post, user_feedback_post_at, share_token, share_enabled, certificate_id, share_visibility, project_name, share_include_feedback, share_include_replay, ai_editor_summary")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setReport(data as unknown as FlowReport);
      setHadReportOnMount((prev) => prev === null ? true : prev);
    } else {
      setReport(null);
      setHadReportOnMount((prev) => prev === null ? false : prev);
    }
  }, [projectId]);

  // Load report on mount / project change
  useEffect(() => {
    setHadReportOnMount(null);
    loadLatestReport();
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Estimate tokens BEFORE running analysis.
   */
  const runPreCheck = useCallback(async (): Promise<TokenEstimation | null> => {
    if (!projectId) return null;
    setError(null);
    setBudgetError(null);

    const [writingRes, threadsRes] = await Promise.all([
      supabase
        .from("writing_content")
        .select("content")
        .eq("project_id", projectId)
        .single(),
      supabase
        .from("chat_threads")
        .select("id")
        .eq("project_id", projectId),
    ]);

    const writing = writingRes.data?.content ?? "";
    const threadIds = (threadsRes.data ?? []).map((t: { id: string }) => t.id);

    let chatText = "";
    if (threadIds.length > 0) {
      const { data: msgs } = await supabase
        .from("chat_messages")
        .select("content")
        .in("thread_id", threadIds);
      chatText = (msgs ?? []).map((m: { content: string }) => m.content).join("\n");
    }

    // Approximate the full prompt (template ~3000 chars + writing + chat + sections)
    const promptApprox = writing + "\n" + chatText + "\n".repeat(3000);
    const estimated = estimateTokens(promptApprox);
    const result = classifyTokenUsage(estimated, settings.preferred_flow_model);
    setPreCheck(result);
    return result;
  }, [projectId, settings.preferred_flow_model]);

  /** Run the actual FLOW analysis via edge function */
  const runAnalysis = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    setBudgetError(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke("analysis", {
        body: { project_id: projectId },
      });

      if (fnErr) {
        const msg = fnErr.message || "";
        // Try structured budget error from data
        if (data?.estimated_cost != null) {
          setBudgetError({
            type: "budget",
            estimated_cost: data.estimated_cost,
            budget_remaining: data.budget_remaining,
            message: data.error || msg,
          });
          setLoading(false);
          return;
        }
        setError(msg || "Analysis failed");
        setLoading(false);
        return;
      }

      if (data?.report) {
        setReport(data.report as unknown as FlowReport);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  /** Save user feedback (pre or post) */
  const saveFeedback = useCallback(
    async (type: "pre" | "post", feedback: FlowFeedback) => {
      if (!report) return;
      const now = new Date().toISOString();
      const update =
        type === "pre"
          ? { user_feedback_pre: feedback as unknown as Json, user_feedback_pre_at: now }
          : { user_feedback_post: feedback as unknown as Json, user_feedback_post_at: now };

      const { error: err } = await supabase
        .from("flow_reports")
        .update(update)
        .eq("id", report.id);

      if (!err) {
        setReport((prev) =>
          prev
            ? {
                ...prev,
                ...(type === "pre"
                  ? { user_feedback_pre: feedback, user_feedback_pre_at: now }
                  : { user_feedback_post: feedback, user_feedback_post_at: now }),
              }
            : prev
        );
      }
    },
    [report]
  );

  /** Save user assessment (scores + free-text comments) */
  const saveUserAssessment = useCallback(
    async (assessment: FlowUserAssessment) => {
      if (!report) return;
      const now = new Date().toISOString();
      const { error: err } = await supabase
        .from("flow_reports")
        .update({
          user_feedback_post: assessment as unknown as Json,
          user_feedback_post_at: now,
        })
        .eq("id", report.id);

      if (!err) {
        setReport((prev) =>
          prev
            ? { ...prev, user_feedback_post: assessment, user_feedback_post_at: now }
            : prev
        );
      }
    },
    [report]
  );

  const clearPreCheck = useCallback(() => setPreCheck(null), []);

  /** Whether the pre-analysis feedback should be offered (first-ever analysis, no prior report) */
  const isFirstAnalysis = hadReportOnMount === false;

  return {
    preCheck,
    runPreCheck,
    clearPreCheck,
    loading,
    report,
    error,
    budgetError,
    runAnalysis,
    loadLatestReport,
    saveFeedback,
    saveUserAssessment,
    isFirstAnalysis,
  };
}
