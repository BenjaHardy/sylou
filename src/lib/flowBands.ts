/**
 * FLOW Band definitions — single source of truth.
 *
 * Numeric scores (0.0–5.0) remain the internal representation used for
 * computation, radar geometry, and storage. The user-facing UI must always
 * render the descriptive band label rather than the raw number.
 */

export type FlowBand = {
  /** Display label shown to the user. */
  label: string;
  /** Main display color (text/border). HSL/hex string. */
  color: string;
  /** Lighter background tint for zones, cards and chips. */
  bgColor: string;
  /** Inclusive lower bound of the band's score range. */
  minScore: number;
  /** Inclusive upper bound of the band's score range. */
  maxScore: number;
  /** Representative midpoint score used when mapping a band selection back
   * to an internal numeric score (e.g. for self-assessment storage). */
  midpoint: number;
};

/**
 * The six FLOW bands, ordered from AI-led (innermost on the radar) to
 * Human-authored (outermost). Colors form a continuous AI → Human gradient
 * that fits the Ethos palette (purples → silver-lake-blue → greens).
 */
export const FLOW_BANDS: FlowBand[] = [
  {
    label: "AI-led",
    color: "#7B2D8E",
    bgColor: "#F3E8F5",
    minScore: 0.0,
    maxScore: 0.5,
    midpoint: 0.25,
  },
  {
    label: "AI-led, human-refined",
    color: "#A85FAB",
    bgColor: "#F7EEF8",
    minScore: 1.0,
    maxScore: 1.5,
    midpoint: 1.25,
  },
  {
    label: "Collaborative",
    color: "#5D89A8",
    bgColor: "#EAF1F8",
    minScore: 2.0,
    maxScore: 2.5,
    midpoint: 2.25,
  },
  {
    label: "Human-led, AI-assisted",
    color: "#3B7A57",
    bgColor: "#E8F1EC",
    minScore: 3.0,
    maxScore: 3.5,
    midpoint: 3.25,
  },
  {
    label: "Human-led",
    color: "#1F5038",
    bgColor: "#DCE9E1",
    minScore: 4.0,
    maxScore: 4.5,
    midpoint: 4.25,
  },
  {
    label: "Human-authored",
    color: "#173B29",
    bgColor: "#CDE0D5",
    minScore: 5.0,
    maxScore: 5.0,
    midpoint: 5.0,
  },
];

/**
 * Concentric zone boundaries for the radar chart. Six zones, drawn from
 * the centre outwards, one per band.
 */
export const FLOW_ZONE_BOUNDARIES = [0, 0.75, 1.75, 2.75, 3.75, 4.75, 5.0] as const;

/** Resolve the band a given score falls into. Null/undefined → null. */
export function getBandForScore(score: number | null | undefined): FlowBand | null {
  if (score === null || score === undefined || Number.isNaN(score)) return null;
  for (const band of FLOW_BANDS) {
    if (score >= band.minScore && score <= band.maxScore) return band;
  }
  // Defensive fallbacks for half-values that land between defined ranges.
  if (score > 0.5 && score < 1.0) return FLOW_BANDS[0];
  if (score > 1.5 && score < 2.0) return FLOW_BANDS[1];
  if (score > 2.5 && score < 3.0) return FLOW_BANDS[2];
  if (score > 3.5 && score < 4.0) return FLOW_BANDS[3];
  if (score > 4.5 && score < 5.0) return FLOW_BANDS[4];
  return null;
}

/** Convenience: band label, with a sensible fallback for null scores. */
export function getBandLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return "Insufficient evidence";
  return getBandForScore(score)?.label ?? "Insufficient evidence";
}
