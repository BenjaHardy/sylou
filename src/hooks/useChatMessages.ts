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

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    supabase
      .from("chat_messages")
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Failed to load messages:", error);
        setMessages((data as ChatMessage[]) ?? []);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [threadId]);

  const sendMessage = useCallback(
    async (content: string, conciseMode: boolean) => {
      if (!threadId || !content.trim()) return;
      setSending(true);

      const userMsg = {
        thread_id: threadId,
        role: "user",
        content: content.trim(),
        source_type: "chat",
        flow_flag: "normal",
        concise_mode: conciseMode,
      };

      const { data: inserted, error: userErr } = await supabase
        .from("chat_messages")
        .insert(userMsg)
        .select()
        .single();

      if (userErr) {
        console.error("Failed to send message:", userErr);
        setSending(false);
        return;
      }

      setMessages((prev) => [...prev, inserted as ChatMessage]);

      // Mock assistant response (will be replaced by Edge Function)
      const mockReply = {
        thread_id: threadId,
        role: "assistant",
        content: "AI responses will be connected soon.",
        source_type: "chat",
        flow_flag: "normal",
        concise_mode: conciseMode,
      };

      const { data: reply, error: replyErr } = await supabase
        .from("chat_messages")
        .insert(mockReply)
        .select()
        .single();

      if (!replyErr && reply) {
        setMessages((prev) => [...prev, reply as ChatMessage]);
      }

      setSending(false);
    },
    [threadId]
  );

  return { messages, loading, sending, sendMessage };
}
