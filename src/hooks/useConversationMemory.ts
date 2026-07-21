import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ConversationMemory {
  summary_text: string;
  covers_through: string;
  covered_message_count: number;
  model_used: string | null;
  updated_at: string;
}

/**
 * The active thread's conversation memory (chat_thread_summaries).
 *
 * Read-only by design: the table has a SELECT-only RLS policy scoped to the
 * caller's own threads (owns_thread); all writes happen server-side in the
 * edge functions' stream tails. Threads under the refresh threshold have no
 * row — `memory` stays null and the UI renders nothing.
 *
 * `refetch` returns the fresh row (or null) so callers can compare
 * watermarks without racing React state updates.
 */
export function useConversationMemory(threadId: string | null) {
  const [memory, setMemory] = useState<ConversationMemory | null>(null);

  // Generation guard (the P3-9 pattern): only the latest fetch may write
  // state, so a slow response from a previous thread can't land here.
  const fetchSeqRef = useRef(0);

  const refetch = useCallback(async (): Promise<ConversationMemory | null> => {
    const seq = ++fetchSeqRef.current;
    if (!threadId) {
      setMemory(null);
      return null;
    }
    const { data, error } = await supabase
      .from("chat_thread_summaries")
      .select("summary_text, covers_through, covered_message_count, model_used, updated_at")
      .eq("thread_id", threadId)
      .maybeSingle();
    if (seq !== fetchSeqRef.current) return null; // superseded — discard
    if (error) {
      console.error("Failed to load conversation memory:", error);
      return null;
    }
    setMemory(data ?? null);
    return data ?? null;
  }, [threadId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { memory, refetch };
}
