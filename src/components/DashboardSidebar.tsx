import { useAuth } from "@/contexts/AuthContext";
import {
  Plus, FolderOpen, ChevronLeft, ChevronRight, LogOut,
  MoreHorizontal, Pencil, Trash2, FileText, GraduationCap,
  Sparkles, Briefcase, Settings as SettingsIcon, Info,
} from "lucide-react";
import { AboutDialog } from "@/components/AboutDialog";
import sylouLogo from "@/assets/sylou-logo.png";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { useProjects, useRenameProject, useDeleteProject, type Project } from "@/hooks/useProjects";
import { Skeleton } from "@/components/ui/skeleton";

const templateIcons: Record<string, typeof FileText> = {
  general: FileText,
  academic: GraduationCap,
  creative: Sparkles,
  professional: Briefcase,
};

interface Props {
  selectedProjectId: string | null;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  disabled?: boolean;
}

export function DashboardSidebar({ selectedProjectId, onSelectProject, onNewProject, disabled }: Props) {
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [renameTarget, setRenameTarget] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const { data: projects, isLoading } = useProjects();
  const renameProject = useRenameProject();
  const deleteProject = useDeleteProject();

  const initials = (user?.user_metadata?.display_name || user?.email || "U")
    .split(" ")
    .map((s: string) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const displayName = user?.user_metadata?.display_name || user?.email || "User";

  const handleRenameSubmit = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    await renameProject.mutateAsync({ id: renameTarget.id, name: renameValue.trim() });
    setRenameTarget(null);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    await deleteProject.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <aside
        className={`h-screen bg-ethos-navy flex flex-col border-r border-sidebar-border shrink-0 transition-all duration-150 ease-ethos-ease print:hidden ${
          collapsed ? "w-16" : "w-[280px]"
        }`}
      >
        {/* Header */}
        <div className="p-4 flex items-center justify-between">
          {!collapsed && <img src={sylouLogo} alt="Sylou" className="h-18" />}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 text-sidebar-muted hover:text-sidebar-foreground transition-colors rounded-md"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        {/* New Project */}
        <div className="px-4">
          <button
            onClick={() => !disabled && onNewProject()}
            className={`rounded-md text-sm transition-all duration-150 ease-ethos-ease ${disabled ? 'opacity-50 cursor-not-allowed' : 'active:scale-[0.98] hover:bg-ethos-navy-light'} ${
              collapsed ? "w-8 h-8 flex items-center justify-center text-sidebar-foreground/70" : "w-full px-3 py-2 text-left text-sidebar-foreground/70"
            }`}
          >
            {collapsed ? <Plus className="h-4 w-4" /> : (
              <span className="flex items-center gap-2">
                <Plus className="h-4 w-4 shrink-0" />
                New Project
              </span>
            )}
          </button>
        </div>

        {/* Projects */}
        <nav className="mt-6 px-4 flex-1 overflow-y-auto">
          {!collapsed && (
            <div className="text-[11px] uppercase tracking-widest text-sidebar-muted font-bold mb-2 px-2">
              Projects
            </div>
          )}
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-8 w-full rounded-md" />
              ))}
            </div>
          ) : projects?.length === 0 ? (
            !collapsed && (
              <p className="text-xs text-sidebar-muted px-2">No projects yet</p>
            )
          ) : (
            projects?.map((project) => {
              const Icon = templateIcons[project.template || "general"] || FolderOpen;
              const isSelected = project.id === selectedProjectId;

              return (
                <div
                  key={project.id}
                  onClick={() => !disabled && onSelectProject(project.id)}
                  className={`group flex items-center gap-2 text-sm rounded-md transition-colors duration-150 ease-ethos-ease ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${
                    collapsed ? "p-2 justify-center" : "px-3 py-2"
                  } ${
                    isSelected
                      ? "bg-ethos-navy-light text-sidebar-foreground font-medium"
                      : "text-sidebar-foreground/70 hover:bg-ethos-navy-light"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="truncate flex-1">{project.name}</span>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          onClick={(e) => e.stopPropagation()}
                          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-sidebar-accent transition-opacity"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget(project);
                              setRenameValue(project.name);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-2" />
                            Rename
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(project);
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </>
                  )}
                </div>
              );
            })
          )}
        </nav>

        {/* User */}
        <div className="p-4 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className={`w-full flex items-center rounded-md hover:bg-ethos-navy-light transition-colors p-1 -m-1 ${
                  collapsed ? "justify-center" : "gap-3"
                }`}
                aria-label="Open user menu"
              >
                <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
                  {initials}
                </div>
                {!collapsed && (
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName}</p>
                    <p className="text-[11px] text-sidebar-muted truncate">{user?.email}</p>
                  </div>
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-medium truncate">{displayName}</p>
                <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setAboutOpen(true)}>
                <Info className="h-4 w-4 mr-2" />
                About
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                <SettingsIcon className="h-4 w-4 mr-2" />
                Settings…
              </DropdownMenuItem>
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />

      {/* Rename dialog */}
      <AlertDialog open={!!renameTarget} onOpenChange={(v) => !v && setRenameTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rename project</AlertDialogTitle>
            <AlertDialogDescription>Enter a new name for this project.</AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRenameSubmit()}
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRenameSubmit} disabled={!renameValue.trim()}>
              Rename
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete project</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This will permanently remove the project and all its content.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
