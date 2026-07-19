import { useState, useCallback, useEffect, useRef } from "react";
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

  // Identity guard (P3-9): the thread this hook currently shows. Synced
  // during render (an idempotent ref write — no effect lag) and read at
  // event time by the stream callbacks in sendMessage. Guards compare it
  // against the thread captured when the send started; comparing two
  // closed-over values would defeat the guard.
  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  // Generation guard (P3-9): stamps every fetch; only the latest may write
  // state, so a slow response from a previous thread can't overwrite the
  // current one. Per-hook-instance and monotonic (not per-thread): in an
  // A→B→A ping-pong the returning-A fetch is the newest and wins.
  const fetchSeqRef = useRef(0);

  const fetchMessages = useCallback(async () => {
    const seq = ++fetchSeqRef.current;
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

    if (seq !== fetchSeqRef.current) return; // superseded — discard silently

    if (error) console.error("Failed to load messages:", error);
    setMessages((data as ChatMessage[]) ?? []);
    setLoading(false);
  }, [threadId]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // A lingering phase pill from a previous thread's stream must not survive
  // a switch — the guarded callbacks stop new writes, not pre-switch state.
  useEffect(() => {
    setPhase(null);
  }, [threadId]);

  const sendMessage = useCallback(
    async (content: string, conciseMode: boolean, webSearchEnabled?: boolean) => {
      if (!threadId || !content.trim()) return;
      setSending(true);

      // This stream belongs to the thread active at send time. Every state
      // write below no-ops unless that thread is still on screen at event
      // time — a mid-stream thread/project switch must not paint into
      // whichever thread the user is now viewing. The server persists the
      // exchange at delivery regardless (stream-first flush), so an
      // off-screen completion is picked up by the refetch on return.
      const sendThreadId = threadId;
      const isActive = () => threadIdRef.current === sendThreadId;

      // ChatPanel keys its typing indicator off this literal id.
      const streamingId = "streaming-assistant";
      const errorBubble = (msg?: string): ChatMessage => ({
        // Unique per bubble — two errors must not share a React key.
        id: `error-${crypto.randomUUID()}`,
        thread_id: sendThreadId,
        role: "assistant",
        content: msg || "Sorry, something went wrong. Please try again.",
        created_at: new Date().toISOString(),
        source_type: "chat",
        flow_flag: null,
        concise_mode: null,
        tutor_mode: null,
        model_used: null,
      });

      // Optimistic: show user message immediately (synchronous with the
      // send — the thread is active by construction). Clearing previous
      // error bubbles keeps a retry visually clean.
      const optimisticId = `optimistic-${Date.now()}`;
      const optimisticMsg: ChatMessage = {
        id: optimisticId,
        thread_id: sendThreadId,
        role: "user",
        content: content.trim(),
        created_at: new Date().toISOString(),
        source_type: null,
        flow_flag: null,
        concise_mode: conciseMode,
        tutor_mode: null,
        model_used: null,
      };
      setMessages((prev) => [
        ...prev.filter((m) => !m.id.startsWith("error-")),
        optimisticMsg,
      ]);

      try {
        // Get fresh auth token
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) {
          console.error("No auth session for chat");
          if (isActive()) {
            setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
          }
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
            thread_id: sendThreadId,
            message: content.trim(),
            concise_mode: conciseMode,
            stream: true,
            ...(webSearchEnabled ? { web_search_enabled: true } : {}),
          }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error("Chat function error:", res.status, errBody);
          let serverMsg = "";
          try {
            const parsed = JSON.parse(errBody);
            if (typeof parsed?.error === "string") serverMsg = parsed.error.slice(0, 200);
          } catch { /* not JSON */ }
          if (isActive()) {
            setMessages((prev) => [
              ...prev.filter((m) => m.id !== optimisticId),
              errorBubble(serverMsg),
            ]);
          }
          setSending(false);
          return;
        }

        const contentType = res.headers.get("content-type") ?? "";

        // ---- SSE streaming path ----
        if (contentType.includes("text/event-stream") && res.body) {
          let receivedDone = false;
          // Accumulated regardless of visibility so a switch-away-and-back
          // mid-stream repaints the bubble with everything received so far.
          // (An "already inserted" boolean would lie after the return
          // refetch replaced state, silently dropping tokens.)
          let streamedText = "";
          const streamStartedAt = new Date().toISOString();

          await consumeSSEStream(res.body, {
            onToken: (text) => {
              streamedText += text;
              if (!isActive()) return;
              setPhase(null); // Clear phase once tokens start arriving
              // Upsert (replace-or-append): stays correct even after a
              // state replacement while this stream was off screen.
              setMessages((prev) => [
                ...prev.filter((m) => m.id !== streamingId),
                {
                  id: streamingId,
                  thread_id: sendThreadId,
                  role: "assistant",
                  content: streamedText,
                  created_at: streamStartedAt,
                  source_type: "chat",
                  flow_flag: null,
                  concise_mode: conciseMode,
                  tutor_mode: null,
                  model_used: null,
                },
              ]);
            },
            onPhase: (p) => {
              if (isActive()) setPhase(p);
            },
            onDone: (evt) => {
              receivedDone = true;
              // Account-level, not thread-level — deliberately unguarded.
              if (evt.budget_remaining != null) {
                setBudgetRemaining(evt.budget_remaining as number);
              }
              if (!isActive()) return; // persisted server-side; refetch shows it
              setPhase(null);
              if (evt.error) {
                const serverMsg = typeof evt.error === "string" ? evt.error.slice(0, 200) : "";
                // Server-side error — show inline error bubble, keep user message
                setMessages((prev) => [
                  ...prev.filter((m) => m.id !== streamingId),
                  errorBubble(serverMsg),
                ]);
                return;
              }
              setMessages((prev) => {
                const without = prev.filter(
                  (m) => m.id !== optimisticId && m.id !== streamingId
                );
                // Dedup by id (appendMessages pattern): a refetch racing
                // the done event may already contain the persisted rows.
                const existingIds = new Set(without.map((m) => m.id));
                const next = [...without];
                const userMsg = evt.user_message as ChatMessage | undefined;
                const assistantMsg = evt.assistant_message as ChatMessage | undefined;
                if (userMsg && !existingIds.has(userMsg.id)) next.push(userMsg);
                if (assistantMsg && !existingIds.has(assistantMsg.id)) {
                  next.push(assistantMsg);
                }
                return next;
              });
            },
            onError: () => {
              if (isActive()) setPhase(null);
            },
          });

          // If we never got a done event, show error instead of silently removing
          if (!receivedDone && isActive()) {
            setMessages((prev) => [
              // Keep the optimistic user message visible
              ...prev.filter((m) => m.id !== streamingId),
              errorBubble(),
            ]);
          }
        } else {
          // ---- JSON fallback (non-streaming response) ----
          const data = await res.json();

          if (data?.error) {
            console.error("Chat API error:", data.error);
            const serverMsg = typeof data.error === "string" ? data.error.slice(0, 200) : "";
            if (isActive()) {
              setMessages((prev) => [
                ...prev.filter((m) => m.id !== optimisticId),
                errorBubble(serverMsg),
              ]);
            }
            setSending(false);
            return;
          }

          if (isActive()) {
            setMessages((prev) => {
              const without = prev.filter((m) => m.id !== optimisticId);
              const existingIds = new Set(without.map((m) => m.id));
              const next = [...without];
              const userMsg = data?.user_message as ChatMessage | undefined;
              const assistantMsg = data?.assistant_message as ChatMessage | undefined;
              if (userMsg && !existingIds.has(userMsg.id)) next.push(userMsg);
              if (assistantMsg && !existingIds.has(assistantMsg.id)) {
                next.push(assistantMsg);
              }
              return next;
            });
          }

          if (data?.budget_remaining != null) {
            setBudgetRemaining(data.budget_remaining);
          }
        }
      } catch (err) {
        console.error("Failed to send message:", err);
        if (isActive()) {
          // Keep user message visible, show error bubble
          setMessages((prev) => [
            ...prev.filter((m) => m.id !== streamingId),
            errorBubble(),
          ]);
        }
      } finally {
        // Global single-flight lock — must clear wherever the user is
        // (deliberately unguarded).
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
    phase,
    sendMessage,
    budgetRemaining,
    refreshMessages: fetchMessages,
    appendMessages,
    setMessages,
  };
}
