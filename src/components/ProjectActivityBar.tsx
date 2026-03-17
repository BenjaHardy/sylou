import { Clock, Pencil, MessageSquare, Shield } from "lucide-react";
import { useProjectStats, type ProjectStats } from "@/hooks/useProjectStats";

interface Props {
  projectId: string;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ProjectActivityBar({ projectId }: Props) {
  const { stats } = useProjectStats(projectId);

  if (!stats) return null;

  const items = [
    { icon: Clock, label: "Active", value: formatDuration(stats.total_active_time_seconds) },
    { icon: Pencil, label: "Writing", value: formatDuration(stats.total_writing_time_seconds) },
    { icon: MessageSquare, label: "Prompts", value: `${stats.chat_prompt_count_normal + stats.chat_prompt_count_tutor}` },
    { icon: Shield, label: "Checks", value: `${stats.sanity_check_count}` },
  ];

  return (
    <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
      {items.map(({ icon: Icon, label, value }) => (
        <span key={label} className="flex items-center gap-1" title={label}>
          <Icon className="h-3 w-3" />
          {value}
        </span>
      ))}
    </div>
  );
}
