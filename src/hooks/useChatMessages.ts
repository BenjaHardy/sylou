import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: string;
  content: string;
  created_at: string;
  source_type: string | null;
  flow_flag: string | null;
  concise_mode: boolean | null;
  tutor_mode: boolean | null;
  model_used: string | null;
}

export function useChatMessages(threadId: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [budgetRemaining, setBudgetRemaining] = useState<number | null>(null);

  const fetchMessages = useCallback(async () => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true });

    if (error) console.error("Failed to load messages:", error);
    setMessages((data as ChatMessage[]) ?? []);
    setLoading(false);
  }, [threadId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  const sendMessage = useCallback(
    async (content: string, conciseMode: boolean) => {
      if (!threadId || !content.trim()) return;
      setSending(true);

      try {
        const { data, error } = await supabase.functions.invoke("chat", {
          body: {
            thread_id: threadId,
            message: content.trim(),
            concise_mode: conciseMode,
          },
        });

        if (error) {
          console.error("Chat function error:", error);
          setSending(false);
          return;
        }

        if (data?.error) {
          console.error("Chat API error:", data.error);
          setSending(false);
          return;
        }

        // Add both messages returned by the edge function
        if (data?.user_message) {
          setMessages((prev) => [...prev, data.user_message as ChatMessage]);
        }
        if (data?.assistant_message) {
          setMessages((prev) => [...prev, data.assistant_message as ChatMessage]);
        }

        if (data?.budget_remaining != null) {
          setBudgetRemaining(data.budget_remaining);
        }
      } catch (err) {
        console.error("Failed to send message:", err);
      } finally {
        setSending(false);
      }
    },
    [threadId]
  );

  const appendMessages = useCallback((newMsgs: ChatMessage[]) => {
    if (!newMsgs.length) return;
    setMessages((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const deduped = newMsgs.filter((m) => !existingIds.has(m.id));
      return deduped.length ? [...prev, ...deduped] : prev;
    });
  }, []);

  return { messages, loading, sending, sendMessage, budgetRemaining, refreshMessages, appendMessages };
}
