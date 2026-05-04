import { useCallback, useEffect, useState } from "react";
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
  subscription_tier: string;
}

const DEFAULTS: UserSettings = {
  display_name: null,
  preferred_language: "English",
  preferred_chat_model: DEFAULT_CHAT_MODEL,
  preferred_flow_model: DEFAULT_FLOW_MODEL,
  default_concise_mode: false,
  email: "",
  subscription_tier: "free",
};

export function useUserSettings() {
  const { user } = useAuth();
  const [settings, setSettings] = useState<UserSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("profiles")
      .select(
        "display_name, preferred_language, preferred_chat_model, preferred_flow_model, default_concise_mode, email, subscription_tier",
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
        subscription_tier: data.subscription_tier ?? "free",
      });
    }
    setLoading(false);
  }, [user]);

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
      if (Object.keys(dbPatch).length === 0) return;
      const { error } = await supabase.from("profiles").update(dbPatch).eq("id", user.id);
      if (error) {
        console.error("[useUserSettings] update failed:", error);
        // Revert by refetching
        refresh();
      }
    },
    [user, refresh],
  );

  return { settings, loading, refresh, update };
}
