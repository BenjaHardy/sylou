import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { consumeSSEStream } from "@/lib/sse-stream";

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
  const [phase, setPhase] = useState<string | null>(null);

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
        // Get fresh auth token
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          console.error("No auth session for chat");
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          setSending(false);
          return;
        }

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({
            thread_id: threadId,
            message: content.trim(),
            concise_mode: conciseMode,
            stream: true,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error("Chat function error:", res.status, errBody);
          setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          setSending(false);
          return;
        }

        const contentType = res.headers.get("content-type") ?? "";

        // ---- SSE streaming path ----
        if (contentType.includes("text/event-stream") && res.body) {
          // Add a streaming placeholder for the assistant
          const streamingId = "streaming-assistant";
          const streamingMsg: ChatMessage = {
            id: streamingId,
            thread_id: threadId,
            role: "assistant",
            content: "",
            created_at: new Date().toISOString(),
            source_type: "chat",
            flow_flag: null,
            concise_mode: conciseMode,
            tutor_mode: null,
            model_used: null,
          };
          setMessages((prev) => [...prev, streamingMsg]);

          let receivedDone = false;

          await consumeSSEStream(res.body, {
            onToken: (text) => {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === streamingId
                    ? { ...m, content: m.content + text }
                    : m
                )
              );
            },
            onDone: (evt) => {
              receivedDone = true;
              setMessages((prev) => {
                const without = prev.filter(
                  (m) => m.id !== optimisticId && m.id !== streamingId
                );
                const next = [...without];
                if (evt.user_message)
                  next.push(evt.user_message as ChatMessage);
                if (evt.assistant_message)
                  next.push(evt.assistant_message as ChatMessage);
                return next;
              });

              if (evt.budget_remaining != null) {
                setBudgetRemaining(evt.budget_remaining as number);
              }
            },
            onError: () => {
              // handled below
            },
          });

          // If we never got a done event, clean up
          if (!receivedDone) {
            setMessages((prev) =>
              prev.filter(
                (m) => m.id !== optimisticId && m.id !== streamingId
              )
            );
          }
        } else {
          // ---- JSON fallback (non-streaming response) ----
          const data = await res.json();

          if (data?.error) {
            console.error("Chat API error:", data.error);
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
            setSending(false);
            return;
          }

          setMessages((prev) => {
            const without = prev.filter((m) => m.id !== optimisticId);
            const next = [...without];
            if (data?.user_message) next.push(data.user_message as ChatMessage);
            if (data?.assistant_message)
              next.push(data.assistant_message as ChatMessage);
            return next;
          });

          if (data?.budget_remaining != null) {
            setBudgetRemaining(data.budget_remaining);
          }
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

  return {
    messages,
    loading,
    sending,
    sendMessage,
    budgetRemaining,
    refreshMessages: fetchMessages,
    appendMessages,
    setMessages,
  };
}
