import { useState } from "react";
import { Clock, Pencil, MessageSquare, Shield, Activity } from "lucide-react";
import { useProjectStats, type ProjectStats } from "@/hooks/useProjectStats";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FlowReportPanel } from "@/components/FlowReportPanel";

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
    <div className="flex items-center gap-4 text-[11px] text-muted-foreground w-full">
      <div className="flex items-center gap-4">
        {items.map(({ icon: Icon, label, value }) => (
          <span key={label} className="flex items-center gap-1" title={label}>
            <Icon className="h-3 w-3" />
            {value}
          </span>
        ))}
      </div>
      <div className="ml-auto">
        <Sheet>
          <SheetTrigger asChild>
            <button className="flex items-center gap-1 text-[11px] text-primary/70 hover:text-primary transition-colors font-medium">
              <Activity className="h-3 w-3" />
              FLOW
            </button>
          </SheetTrigger>
          <SheetContent className="w-[420px] sm:w-[480px] p-0">
            <SheetHeader className="px-6 pt-6 pb-3">
              <SheetTitle>FLOW Report</SheetTitle>
            </SheetHeader>
            <ScrollArea className="h-[calc(100vh-80px)] px-6 pb-6">
              <FlowReportPanel projectId={projectId} />
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}
