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

      // Optimistic: show user message immediately
      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticMsg: ChatMessage = {
        id: optimisticId,
        thread_id: threadId,
        role: "user",
        content: content.trim(),
        created_at: new Date().toISOString(),
        source_type: null,
        flow_flag: null,
        concise_mode: conciseMode,
        tutor_mode: null,
        model_used: null,
      };
      setMessages((prev) => [...prev, optimisticMsg]);

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
          // Remove optimistic message on error
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          setSending(false);
          return;
        }

        if (data?.error) {
          console.error("Chat API error:", data.error);
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          setSending(false);
          return;
        }

        // Replace optimistic message with real one, add assistant message
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== optimisticId);
          const next = [...without];
          if (data?.user_message) next.push(data.user_message as ChatMessage);
          if (data?.assistant_message) next.push(data.assistant_message as ChatMessage);
          return next;
        });

        if (data?.budget_remaining != null) {
          setBudgetRemaining(data.budget_remaining);
        }
      } catch (err) {
        console.error("Failed to send message:", err);
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
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

  return { messages, loading, sending, sendMessage, budgetRemaining, refreshMessages: fetchMessages, appendMessages };
}
