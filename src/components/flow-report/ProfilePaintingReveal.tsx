import { useState } from "react";
import { Sparkles, ExternalLink } from "lucide-react";
import { PROFILE_PAINTINGS } from "@/lib/flow-profile-paintings";

interface ProfilePaintingRevealProps {
  code: string;
}

export default function ProfilePaintingReveal({ code }: ProfilePaintingRevealProps) {
  const [revealed, setRevealed] = useState(false);
  const painting = PROFILE_PAINTINGS[code];

  if (!painting) return null;

  if (!revealed) {
    return (
      <div
        data-ai-generated="false"
        className="flex flex-col items-center gap-2 pt-2"
      >
        <button
          type="button"
          onClick={() => setRevealed(true)}
          aria-label="Reveal your profile's painting"
          className="group relative w-[140px] h-[140px] rounded-lg border-2 border-dashed border-[#5D89A8]/40 bg-[#5D89A8]/5 hover:bg-[#5D89A8]/10 hover:border-[#5D89A8]/70 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md flex flex-col items-center justify-center gap-2 cursor-pointer"
        >
          <Sparkles className="w-8 h-8 text-[#5D89A8] group-hover:scale-110 transition-transform" />
          <span className="text-[11px] font-medium text-muted-foreground px-2 text-center leading-tight">
            Reveal your profile's painting
          </span>
        </button>
      </div>
    );
  }

  return (
    <div
      data-ai-generated="false"
      className="flex flex-col items-center gap-3 pt-2 animate-fade-in"
      style={{ animationDuration: "400ms" }}
    >
      <a
        href={painting.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block max-w-full"
      >
        <img
          src={painting.image}
          alt={`${painting.title} by ${painting.artist}`}
          className="max-h-[360px] w-auto object-contain rounded-md shadow-md border"
          loading="lazy"
        />
      </a>
      <div className="text-center space-y-1 max-w-md">
        <p className="italic text-foreground font-medium">{painting.title}</p>
        <p className="text-sm text-muted-foreground">
          {painting.artist} · {painting.year}
        </p>
      </div>
      <p className="italic text-sm text-muted-foreground/90 text-center max-w-md leading-relaxed">
        {painting.rationale}
      </p>
      <div className="flex items-center gap-3 text-xs">
        <a
          href={painting.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[#5D89A8] hover:underline"
        >
          Wikimedia Commons
          <ExternalLink className="w-3 h-3" />
        </a>
        <span className="text-muted-foreground/40">·</span>
        <button
          type="button"
          onClick={() => setRevealed(false)}
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          Hide
        </button>
      </div>
    </div>
  );
}
