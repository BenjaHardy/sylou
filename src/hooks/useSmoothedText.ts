// useSmoothedText — reveal a growing streamed string at a smooth, adaptive
// rate (the pure math lives in src/lib/stream-smoothing.ts; this hook is
// the thin timer/React glue).
//
// Contract:
//   - Mount snaps to the CURRENT text (a thread switched back mid-stream
//     repaints its full partial instantly — the P3-9 behavior — and only
//     growth after mount is smoothed).
//   - A shrinking or non-extension target (new stream reusing the
//     instance) snaps via isStreamReset.
//   - The interval lives exactly as long as the component; unmount (the
//     done-swap, an error bubble, a removed row) clears it.
//
// Deliberately downstream of everything load-bearing: useChatMessages'
// accumulation, persistence, and the SSE lifecycle are untouched — this
// only chooses when already-received characters are painted.

import { useEffect, useRef, useState } from "react";
import { isStreamReset, nextRevealLength, SMOOTH_TICK_MS } from "@/lib/stream-smoothing";

export function useSmoothedText(target: string): string {
  const [displayLen, setDisplayLen] = useState(() => target.length);
  const targetRef = useRef(target);
  const prevTargetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const prev = prevTargetRef.current;
    prevTargetRef.current = target;
    if (isStreamReset(prev, target)) {
      setDisplayLen(target.length);
    }
  }, [target]);

  useEffect(() => {
    const id = setInterval(() => {
      setDisplayLen((len) => nextRevealLength(len, targetRef.current));
    }, SMOOTH_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return target.slice(0, Math.min(displayLen, target.length));
}
