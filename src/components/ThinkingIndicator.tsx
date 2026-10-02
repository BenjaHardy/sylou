import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

/** "Thinking…" with the seconds elapsed since it appeared. Mounted only
 *  while a stream is in its reasoning phase (the server emits one
 *  `thinking` phase at the first reasoning chunk; the first answer token
 *  clears it), so the clock starts and stops with the component. */
export function ThinkingIndicator({ className = "text-xs" }: { className?: string }) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.floor((now - startedAt) / 1000);
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-muted-foreground ${className}`}>
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      <span>Thinking…{seconds > 0 ? ` ${seconds}s` : ""}</span>
    </span>
  );
}
