// Stream-reveal smoothing — the pure math behind useSmoothedText.
//
// Why: providers stream at very different granularities. Mistral emits
// near-token fragments (smooth), while Anthropic coalesces output into
// multi-word content_block_delta chunks (verified 2026-08 via the
// Network-panel event stream), so Claude answers visibly "step" in
// clumps. The edge pipeline forwards deltas 1:1 (see _shared/_sse.ts) —
// the clumping is born at the provider, so the fix lives at the
// presentation layer: accept text as fast as it arrives, REVEAL it at a
// smooth rate. Content is never altered — only when received characters
// become pixels.
//
// The step is PROPORTIONAL to the backlog (unrevealed chars), which makes
// the reveal self-tuning: tiny backlogs (smooth providers) reveal
// instantly — zero added lag — while a large clump drains geometrically
// (~90% in under a second at 30Hz). A fixed-rate typewriter would drift
// unboundedly behind fast generators; a proportional one settles at a
// small constant trail instead. SMOOTH_SNAP_CAP converts any pathological
// backlog (throttled background tab, very fast model) into an instant
// snap — i.e. exactly today's behavior.

export const SMOOTH_TICK_MS = 33;
export const SMOOTH_MIN_STEP = 2;
export const SMOOTH_CATCH_UP = 0.1;
export const SMOOTH_SNAP_CAP = 1500;

/**
 * Next reveal length for one tick. Guarantees: never regresses, never
 * exceeds the target, and never ends the reveal between a surrogate pair
 * (slicing an emoji in half renders a broken glyph — same lesson as the
 * edge functions' sliceSafe, P3-7e). A LONE high surrogate at the very
 * end of the target (a pair split across provider deltas) is held back
 * until its partner arrives.
 */
export function nextRevealLength(revealed: number, target: string): number {
  const len = target.length;
  if (revealed >= len) return len;
  const backlog = len - revealed;
  if (backlog > SMOOTH_SNAP_CAP) return len;
  const step = Math.max(SMOOTH_MIN_STEP, Math.ceil(backlog * SMOOTH_CATCH_UP));
  let next = Math.min(len, revealed + step);
  const boundary = target.charCodeAt(next - 1);
  if (boundary >= 0xd800 && boundary <= 0xdbff) {
    next = next < len ? next + 1 : next - 1;
  }
  return Math.max(next, revealed);
}

/**
 * A target that shrank or stopped being an extension of the previous one
 * is a NEW stream reusing the same component instance — the reveal must
 * snap rather than replay old lengths against new text.
 */
export function isStreamReset(prevTarget: string, target: string): boolean {
  return target.length < prevTarget.length || !target.startsWith(prevTarget);
}
