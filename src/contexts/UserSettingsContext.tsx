import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { DEFAULT_CHAT_MODEL, DEFAULT_FLOW_MODEL } from "@/lib/models";

export interface UserSettings {
  display_name: string | null;
  preferred_language: string | null;
  preferred_chat_model: string;
  preferred_flow_model: string;
  default_concise_mode: boolean;
  email: string;
  // Read-only budget fields. Operators set monthly_token_budget per user via
  // SQL; users can't modify these (RLS freezes both columns). A null budget
  // means "no limit" — enforced server-side in edge function pre-flight checks.
  tokens_used_this_period: number;
  monthly_token_budget: number | null;
}

const DEFAULTS: UserSettings = {
  display_name: null,
  preferred_language: "English",
  preferred_chat_model: DEFAULT_CHAT_MODEL,
  preferred_flow_model: DEFAULT_FLOW_MODEL,
  default_concise_mode: false,
  email: "",
  tokens_used_this_period: 0,
  monthly_token_budget: null,
};

interface UserSettingsContextType {
  settings: UserSettings;
  loading: boolean;
  refresh: () => Promise<void>;
  update: (patch: Partial<UserSettings>) => Promise<void>;
}

const UserSettingsContext = createContext<UserSettingsContextType | undefined>(
  undefined,
);

export function UserSettingsProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session || !user) {
      setSettings(DEFAULTS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select(
        "display_name, preferred_language, preferred_chat_model, preferred_flow_model, default_concise_mode, email, tokens_used_this_period, monthly_token_budget",
      )
      .eq("id", user.id)
      .maybeSingle();
    if (data) {
      setSettings({
        display_name: data.display_name ?? null,
        preferred_language: data.preferred_language ?? "English",
        preferred_chat_model: data.preferred_chat_model ?? DEFAULT_CHAT_MODEL,
        preferred_flow_model:
          (data as { preferred_flow_model?: string }).preferred_flow_model ?? DEFAULT_FLOW_MODEL,
        default_concise_mode:
          (data as { default_concise_mode?: boolean }).default_concise_mode ?? false,
        email: data.email ?? user.email ?? "",
        tokens_used_this_period:
          (data as { tokens_used_this_period?: number }).tokens_used_this_period ?? 0,
        monthly_token_budget:
          (data as { monthly_token_budget?: number | null }).monthly_token_budget ?? null,
      });
    }
    setLoading(false);
  }, [session, user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const update = useCallback(
    async (patch: Partial<UserSettings>) => {
      if (!user) return;
      // Optimistic
      setSettings((prev) => ({ ...prev, ...patch }));
      const dbPatch: Record<string, unknown> = {};
      if (patch.display_name !== undefined) dbPatch.display_name = patch.display_name;
      if (patch.preferred_language !== undefined)
        dbPatch.preferred_language = patch.preferred_language;
      if (patch.preferred_chat_model !== undefined)
        dbPatch.preferred_chat_model = patch.preferred_chat_model;
      if (patch.preferred_flow_model !== undefined)
        dbPatch.preferred_flow_model = patch.preferred_flow_model;
      if (patch.default_concise_mode !== undefined)
        dbPatch.default_concise_mode = patch.default_concise_mode;
      // tokens_used_this_period and monthly_token_budget are intentionally
      // not writable from the client (frozen by RLS).
      if (Object.keys(dbPatch).length === 0) return;
      const { error } = await supabase.from("profiles").update(dbPatch).eq("id", user.id);
      if (error) {
        console.error("[UserSettings] update failed:", error);
        refresh();
      }
    },
    [user, refresh],
  );

  return (
    <UserSettingsContext.Provider value={{ settings, loading, refresh, update }}>
      {children}
    </UserSettingsContext.Provider>
  );
}

export function useUserSettingsContext() {
  const ctx = useContext(UserSettingsContext);
  if (!ctx) throw new Error("useUserSettings must be used within UserSettingsProvider");
  return ctx;
}
