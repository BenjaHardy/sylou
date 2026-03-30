import { useState, useCallback, useEffect } from "react";
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

/**
 * SSE line parser: accumulates partial chunks, yields complete `data:` payloads.
 */
function createSSEParser() {
  let buffer = "";
  return {
    /** Feed raw text from the stream; returns parsed JSON events. */
    feed(chunk: string): Array<Record<string, unknown>> {
      buffer += chunk;
      const events: Array<Record<string, unknown>> = [];
      // Split on double-newline (SSE event boundary)
      const parts = buffer.split("\n\n");
      // Last part may be incomplete — keep in buffer
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            events.push(JSON.parse(payload));
          } catch {
            // skip malformed
          }
        }
      }
      return events;
    },
  };
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

  // Fetch on threadId change
  // We use a simple pattern: the parent should call refreshMessages or rely on
  // the initial load via useEffect in the component that consumes this hook.
  // (The old useEffect was moved to the consumer to avoid double-fetching.)

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
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          const parser = createSSEParser();

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

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value, { stream: true });
              const events = parser.feed(chunk);

              for (const evt of events) {
                if (evt.token && typeof evt.token === "string") {
                  // Append token to streaming message
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === streamingId
                        ? { ...m, content: m.content + (evt.token as string) }
                        : m
                    )
                  );
                }

                if (evt.done === true) {
                  receivedDone = true;
                  // Replace optimistic + streaming with final persisted messages
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
                }
              }
            }
          } catch (streamErr) {
            console.error("Stream reading error:", streamErr);
          }

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
  };
}
