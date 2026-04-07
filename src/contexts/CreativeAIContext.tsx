import { createContext, useContext, type ReactNode } from "react";
import type { ChatMessage } from "@/hooks/useChatMessages";

interface CreativeAIContextValue {
  projectId: string;
  threadId: string | null;
  tutorMode: boolean;
  conciseMode: boolean;
  webSearchEnabled: boolean;
  chatSetMessages: ((updater: (prev: ChatMessage[]) => ChatMessage[]) => void) | undefined;
  onChatRefresh: () => void;
  onAskComplete: (msgs: ChatMessage[]) => void;
}

const CreativeAIContext = createContext<CreativeAIContextValue | null>(null);

export function useCreativeAI() {
  const ctx = useContext(CreativeAIContext);
  if (!ctx) throw new Error("useCreativeAI must be used within CreativeAIContextProvider");
  return ctx;
}

export function CreativeAIContextProvider({
  children,
  ...value
}: CreativeAIContextValue & { children: ReactNode }) {
  return (
    <CreativeAIContext.Provider value={value}>
      {children}
    </CreativeAIContext.Provider>
  );
}
