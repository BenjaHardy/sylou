import { FLOW_BANDS, getBandForScore } from "@/lib/flowBands";

interface BandSelectorProps {
  /** Current internal numeric score (or null). */
  value: number | null;
  /** Called with the new internal numeric score (band midpoint). */
  onChange: (score: number) => void;
  /** Smaller variant used in dense forms. */
  compact?: boolean;
  /** Disables interaction (read-only). */
  disabled?: boolean;
}

/**
 * Band selector — six band chips that map to the corresponding band's
 * representative midpoint score on selection.
 */
export function BandSelector({ value, onChange, compact, disabled }: BandSelectorProps) {
  const selected = getBandForScore(value);

  return (
    <div className={`flex flex-wrap gap-1.5 ${compact ? "" : "gap-2"}`}>
      {FLOW_BANDS.map((band) => {
        const isSelected = selected?.label === band.label;
        return (
          <button
            type="button"
            key={band.label}
            disabled={disabled}
            onClick={() => onChange(band.midpoint)}
            className={`rounded-full border transition-all text-[11px] font-medium ${
              compact ? "px-2 py-0.5" : "px-2.5 py-1"
            } ${disabled ? "cursor-not-allowed opacity-60" : "hover:opacity-90"}`}
            style={{
              backgroundColor: isSelected ? band.color : band.bgColor,
              color: isSelected ? "#fff" : band.color,
              borderColor: band.color + (isSelected ? "" : "55"),
            }}
            aria-pressed={isSelected}
          >
            {band.label}
          </button>
        );
      })}
    </div>
  );
}
