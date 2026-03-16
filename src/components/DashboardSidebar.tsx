import { useAuth } from "@/contexts/AuthContext";
import { Plus, FolderOpen, ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import ethosLogo from "@/assets/ethos-logo.png";
import { useState } from "react";

const placeholderProjects = ["Internal Audit", "System Architecture", "Client Portal"];

export function DashboardSidebar() {
  const { user, signOut } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

  const initials = (user?.user_metadata?.display_name || user?.email || "U")
    .split(" ")
    .map((s: string) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const displayName = user?.user_metadata?.display_name || user?.email || "User";

  return (
    <aside
      className={`h-screen bg-ethos-navy flex flex-col border-r border-sidebar-border shrink-0 transition-all duration-150 ease-ethos-ease ${
        collapsed ? "w-16" : "w-[280px]"
      }`}
    >
      {/* Header */}
      <div className="p-4 flex items-center justify-between">
        {!collapsed && (
          <img src={ethosLogo} alt="Ethos" className="h-12" />
        )}
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
          className={`bg-primary hover:bg-ethos-hover text-primary-foreground rounded-md text-sm font-medium transition-all duration-150 ease-ethos-ease active:scale-[0.98] ${
            collapsed ? "w-8 h-8 flex items-center justify-center" : "w-full py-2"
          }`}
        >
          {collapsed ? <Plus className="h-4 w-4" /> : "+ New Project"}
        </button>
      </div>

      {/* Projects */}
      <nav className="mt-8 px-4 flex-1 overflow-y-auto">
        {!collapsed && (
          <div className="text-[11px] uppercase tracking-widest text-sidebar-muted font-bold mb-2 px-2">
            Projects
          </div>
        )}
        {placeholderProjects.map((project) => (
          <div
            key={project}
            className={`flex items-center gap-2 text-sm text-sidebar-foreground/70 hover:bg-ethos-navy-light rounded-md cursor-pointer transition-colors duration-150 ease-ethos-ease ${
              collapsed ? "p-2 justify-center" : "px-3 py-2"
            }`}
          >
            <FolderOpen className="h-4 w-4 shrink-0" />
            {!collapsed && <span className="truncate">{project}</span>}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="p-4 border-t border-sidebar-border">
        <div className={`flex items-center ${collapsed ? "justify-center" : "gap-4"}`}>
          <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-sidebar-foreground truncate">{displayName}</p>
              <button
                onClick={signOut}
                className="text-xs text-sidebar-muted hover:text-sidebar-foreground transition-colors flex items-center gap-1"
              >
                <LogOut className="h-3 w-3" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
