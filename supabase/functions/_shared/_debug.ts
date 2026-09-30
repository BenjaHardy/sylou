// SYLOU_DEBUG_LOG_CONTENT=true lets the functions log users' text: full FLOW
// prompts and model responses, and web-search queries. Off by default, because
// log copies outlive account deletion and are easily shared while debugging.

export function parseContentLogsSetting(value: string | undefined): boolean {
  return value === "true";
}

let enabled: boolean | undefined;

export function contentLogsEnabled(): boolean {
  if (enabled === undefined) {
    let value: string | undefined;
    try {
      value = Deno.env.get("SYLOU_DEBUG_LOG_CONTENT");
    } catch {
      // No env access (the unit tests run without it).
      value = undefined;
    }
    enabled = parseContentLogsSetting(value);
    if (enabled) {
      console.warn(
        "[debug] SYLOU_DEBUG_LOG_CONTENT is on: these logs include users' text. Unset it when you are done debugging.",
      );
    }
  }
  return enabled;
}
