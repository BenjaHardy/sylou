import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { estimateTokens, classifyTokenUsage, type TokenEstimation } from "@/lib/estimateTokens";
import type { Json } from "@/integrations/supabase/types";

export interface FlowPillar {
  reasoning: string;
  evidence: string[];
  score: number | null;
  narrative: string;
}

export interface FlowReport {
  id: string;
  project_id: string;
  ai_summary: string;
  ai_find: FlowPillar;
  ai_lead: FlowPillar;
  ai_organize: FlowPillar;
  ai_write: FlowPillar;
  flow_meta: {
    estimated_input_tokens: number;
    context_limit_tokens: number;
    token_status: string;
    measured_at: string;
    similarity_pct?: number;
    write_score_capped?: boolean;
  } | null;
  metrics_snapshot: {
    total_active_time_seconds: number;
    total_writing_time_seconds: number;
    chat_prompt_count_normal: number;
    chat_prompt_count_tutor: number;
    sanity_check_count: number;
    first_activity_at: string | null;
    last_activity_at: string | null;
    clock_anomaly_count: number;
  } | null;
  model_used: string;
  created_at: string;
}

interface BudgetError {
  type: "budget";
  estimated_cost: number;
  budget_remaining: number;
  message: string;
}

export function useFlowAnalysis(projectId: string | null) {
  const [preCheck, setPreCheck] = useState<TokenEstimation | null>(null);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<FlowReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [budgetError, setBudgetError] = useState<BudgetError | null>(null);

  /** Load the latest existing flow report for this project */
  const loadLatestReport = useCallback(async () => {
    if (!projectId) return;
    const { data } = await supabase
      .from("flow_reports")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setReport(data as unknown as FlowReport);
    }
  }, [projectId]);

  /**
   * Estimate tokens BEFORE running analysis.
   * Fetches writing + chat to build an approximation of the prompt size.
   */
  const runPreCheck = useCallback(async (): Promise<TokenEstimation | null> => {
    if (!projectId) return null;
    setError(null);
    setBudgetError(null);

    // Fetch writing content + chat messages in parallel
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

    // Approximate the full prompt (template ~2500 chars + writing + chat + sections)
    const promptApprox = writing + "\n" + chatText + "\n".repeat(2500);
    const estimated = estimateTokens(promptApprox);
    const result = classifyTokenUsage(estimated, "claude-sonnet-4-6");
    setPreCheck(result);
    return result;
  }, [projectId]);

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
        // Check for budget error (403)
        const msg = fnErr.message || "";
        if (msg.includes("Insufficient token budget") || fnErr.context?.status === 403) {
          // Try to parse structured budget info from the response
          try {
            const parsed = typeof data === "object" ? data : JSON.parse(msg);
            if (parsed?.estimated_cost != null) {
              setBudgetError({
                type: "budget",
                estimated_cost: parsed.estimated_cost,
                budget_remaining: parsed.budget_remaining,
                message: parsed.error || msg,
              });
              setLoading(false);
              return;
            }
          } catch {
            // Fall through to generic error
          }
          setError(msg);
          setLoading(false);
          return;
        }
        setError(fnErr.message || "Analysis failed");
        setLoading(false);
        return;
      }

      if (data?.report) {
        setReport(data.report as unknown as FlowReport);
      }
    } catch (e: any) {
      setError(e.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const clearPreCheck = useCallback(() => setPreCheck(null), []);

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
  };
}
