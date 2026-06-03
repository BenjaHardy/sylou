import { useEffect, useState } from "react";

export interface InstanceConfig {
  webSearchEnabled: boolean;
}

// Module-level cache: capability flags are stable for the lifetime of an
// instance. They cannot change mid-session, and an operator who flips
// BRAVE_SEARCH_API_KEY (or any future capability env var) should expect
// users to reload to pick up the change. No refetch() is exposed in v1
// by design — keep this cache lifetime intentional.
let cachedConfig: InstanceConfig | null = null;
let inflight: Promise<InstanceConfig> | null = null;

async function fetchInstanceConfig(): Promise<InstanceConfig> {
  // Mirrors the chat call pattern (see src/hooks/useChatMessages.ts):
  // construct the URL from VITE_SUPABASE_URL and send the publishable apikey
  // header — required by the Supabase Functions gateway even for endpoints
  // with verify_jwt = false.
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/config`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
  });
  if (!res.ok) throw new Error(`config endpoint returned ${res.status}`);
  const data = await res.json();
  return {
    webSearchEnabled: data?.web_search_enabled !== false,
  };
}

/**
 * Returns capability flags exposed by the backend /config endpoint.
 *
 * On fetch failure, defaults `webSearchEnabled` to `true` — we never want
 * to silently disable a feature that might actually be configured. The
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
        .then((c) => {
          cachedConfig = c;
          return c;
        })
        .catch((err) => {
          console.warn(
            "[useInstanceConfig] failed to fetch /config — defaulting capabilities to enabled:",
            err,
          );
          const fallback: InstanceConfig = { webSearchEnabled: true };
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
    loading,
  };
}
