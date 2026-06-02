import { Clock, Pencil, MessageSquare } from "lucide-react";
import { useProjectStats, type ProjectStats } from "@/hooks/useProjectStats";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface Props {
  projectId: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const ACTIVITY_TOOLTIPS = {
  Active: "Total time the project was open and the user was actively interacting (typing, clicking, scrolling).",
  Writing: "Time spent typing or editing in the writing editor specifically.",
  Prompts: "Number of messages sent to the AI chat assistant.",
} as const;

export function ProjectActivityBar({ projectId }: Props) {
  const { stats } = useProjectStats(projectId);

  if (!stats) return null;

  const items = [
    { icon: Clock, label: "Active" as const, value: formatDuration(stats.total_active_time_seconds) },
    { icon: Pencil, label: "Writing" as const, value: formatDuration(stats.total_writing_time_seconds) },
    { icon: MessageSquare, label: "Prompts" as const, value: `${stats.chat_prompt_count_normal + stats.chat_prompt_count_tutor}` },
  ];

  return (
    <TooltipProvider>
      <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
        {items.map(({ icon: Icon, label, value }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1 cursor-help">
                <Icon className="h-3 w-3" />
                {value}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-xs">
              {ACTIVITY_TOOLTIPS[label]}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
