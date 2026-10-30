import { ImageIcon } from "lucide-react";

// Images in model output render as links, so the browser requests nothing a
// reply names until the reader clicks. react-markdown has already filtered
// the address: an unsafe one arrives empty and stays plain text.
export function MarkdownImageLink({ src, alt }: { src?: string; alt?: string }) {
  const label = alt?.trim() || "Image";
  const icon = <ImageIcon className="inline h-3.5 w-3.5 mr-1 align-text-bottom" />;
  if (!src) {
    return (
      <span>
        {icon}
        {label}
      </span>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary/80">
      {icon}
      {label}
    </a>
  );
}
