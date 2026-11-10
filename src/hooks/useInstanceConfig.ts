import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isLocalModel, type LocalModel } from "@/lib/models";

export interface InstanceConfig {
  webSearchEnabled: boolean;
  /** The local models this instance lists, as their server reported them
   *  when the page loaded: empty when it lists none, null when the config
   *  endpoint could not be read. */
  localModels: LocalModel[] | null;
}

// Module-level cache: capability flags are stable for the lifetime of an
// instance. They cannot change mid-session, and an operator who flips
// BRAVE_SEARCH_API_KEY (or any future capability env var) should expect
// users to reload to pick up the change. No refetch() is exposed in v1
// by design — keep this cache lifetime intentional. The endpoint lists the
// local models to signed-in callers only, so an answer fetched without a
// session is not kept.
let cachedConfig: InstanceConfig | null = null;
let inflight: Promise<InstanceConfig> | null = null;

async function fetchInstanceConfig(): Promise<{ config: InstanceConfig; signedIn: boolean }> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  // Mirrors the chat call pattern (see src/hooks/useChatMessages.ts):
  // construct the URL from VITE_SUPABASE_URL and send the publishable apikey
  // header — required by the Supabase Functions gateway even for endpoints
  // with verify_jwt = false.
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/config`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`config endpoint returned ${res.status}`);
  const data = await res.json();
  return {
    config: {
      webSearchEnabled: data?.web_search_enabled !== false,
      localModels: parseLocalModels(data?.local_models),
    },
    signedIn: !!token,
  };
}

/** The endpoint's `local_models`, kept to well-formed entries. */
export function parseLocalModels(raw: unknown): LocalModel[] {
  if (!Array.isArray(raw)) return [];
  const models: LocalModel[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== "string" || !isLocalModel(e.id) || typeof e.name !== "string") continue;
    models.push({
      id: e.id,
      name: e.name,
      ...(typeof e.context_tokens === "number" && e.context_tokens > 0 ? { contextTokens: e.context_tokens } : {}),
      ...(typeof e.tools === "boolean" ? { tools: e.tools } : {}),
      ...(typeof e.problem === "string" ? { problem: e.problem } : {}),
      ...(e.not_answering === true ? { notAnswering: true } : {}),
    });
  }
  return models;
}

/**
 * Returns capability flags exposed by the backend /config endpoint.
 *
 * On fetch failure, defaults `webSearchEnabled` to `true` — we never want
 * to silently disable a feature that might actually be configured — and
 * `localModels` to null, which the UI shows as "couldn't check". The
 * failure is logged so a misconfigured deployment is debuggable.
 */
export function useInstanceConfig(): InstanceConfig & { loading: boolean } {
  const [config, setConfig] = useState<InstanceConfig | null>(cachedConfig);
  const [loading, setLoading] = useState<boolean>(cachedConfig === null);

  useEffect(() => {
    if (cachedConfig) {
      setConfig(cachedConfig);
      setLoading(false);
      return;
    }
    let cancelled = false;
    if (!inflight) {
      inflight = fetchInstanceConfig()
        .then(({ config: c, signedIn }) => {
          if (signedIn) cachedConfig = c;
          return c;
        })
        .catch((err) => {
          console.warn(
            "[useInstanceConfig] failed to fetch /config — defaulting capabilities to enabled:",
            err,
          );
          const fallback: InstanceConfig = { webSearchEnabled: true, localModels: null };
          cachedConfig = fallback;
          return fallback;
        })
        .finally(() => {
          inflight = null;
        });
    }
    inflight.then((c) => {
      if (cancelled) return;
      setConfig(c);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    webSearchEnabled: config?.webSearchEnabled ?? true,
    localModels: config?.localModels ?? null,
    loading,
  };
}
