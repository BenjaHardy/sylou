import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";
import { useCreateProject, useProjects, useProfile } from "@/hooks/useProjects";
import { toast } from "@/hooks/use-toast";

const LANGUAGES = [
  "English", "French", "Dutch", "German", "Italian", "Spanish", "Portuguese", "Polish",
];

const TEMPLATES = [
  { value: "general", label: "General", desc: "A blank canvas for any type of writing.", proOnly: false },
  { value: "academic", label: "Academic", desc: "Structured for essays, papers, and research.", proOnly: true },
  { value: "creative", label: "Creative", desc: "Optimised for fiction, poetry, and storytelling.", proOnly: true },
  { value: "professional", label: "Professional", desc: "Tailored for reports, emails, and business docs.", proOnly: true },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (id: string) => void;
}

export function NewProjectDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("English");
  const [template, setTemplate] = useState("general");
  const [tutorMode, setTutorMode] = useState(false);

  const createProject = useCreateProject();
  const { data: projects } = useProjects();
  const { data: profile } = useProfile();

  const isFree = profile?.subscription_tier === "free";
  const atLimit = isFree && (projects?.length ?? 0) >= 1;

  const reset = () => {
    setName("");
    setLanguage("English");
    setTemplate("general");
    setTutorMode(false);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;

    if (atLimit) {
      toast({
        title: "Free tier limit",
        description: "Free accounts are limited to 1 project. Delete your existing project or upgrade to create more.",
        variant: "destructive",
      });
      return;
    }

    try {
      const project = await createProject.mutateAsync({
        name: name.trim(),
        language,
        template,
        tutor_mode: tutorMode,
        tutor_mode_locked: tutorMode,
      });
      reset();
      onOpenChange(false);
      onCreated(project.id);
    } catch (err: any) {
      toast({
        title: "Error creating project",
        description: err.message?.includes("unique") ? "A project with that name already exists." : err.message,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
        </DialogHeader>

        {atLimit ? (
          <div className="py-4 space-y-2">
            <p className="text-sm text-foreground font-medium">Free tier limit reached</p>
            <p className="text-sm text-muted-foreground">
              Free accounts can have at most 1 project. Delete your existing project or upgrade your plan to create more.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="project-name">Project name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My writing project"
                autoFocus
              />
            </div>

            {/* Language */}
            <div className="space-y-1.5">
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>{l}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Template */}
            <div className="space-y-2">
              <Label>Template</Label>
              <div className="grid gap-2">
                {TEMPLATES.map((t) => (
                  <label
                    key={t.value}
                    className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                      template === t.value
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="template"
                      value={t.value}
                      checked={template === t.value}
                      onChange={() => setTemplate(t.value)}
                      className="mt-0.5 accent-primary"
                    />
                    <div>
                      <span className="text-sm font-medium text-foreground">{t.label}</span>
                      <p className="text-xs text-muted-foreground">{t.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Tutor mode */}
            <div className="flex items-center justify-between rounded-md border border-border p-3">
              <div className="flex items-center gap-2">
                <Label htmlFor="tutor-mode" className="cursor-pointer">Tutor Mode</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[240px] text-xs">
                    In Tutor Mode, the AI guides your learning through questions rather than giving direct answers. This cannot be changed after project creation.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Switch
                id="tutor-mode"
                checked={tutorMode}
                onCheckedChange={setTutorMode}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onOpenChange(false); }}>
            Cancel
          </Button>
          {!atLimit && (
            <Button onClick={handleCreate} disabled={!name.trim() || createProject.isPending}>
              {createProject.isPending ? "Creating…" : "Create Project"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
