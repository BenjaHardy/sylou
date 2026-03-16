import { DashboardSidebar } from "@/components/DashboardSidebar";
import { FolderOpen } from "lucide-react";

export default function Index() {
  return (
    <div className="flex min-h-screen w-full">
      <DashboardSidebar />
      <main className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto" />
          <h1 className="text-xl font-semibold text-foreground">
            Select or create a project
          </h1>
          <p className="text-sm text-muted-foreground">
            Get started by creating a new project from the sidebar.
          </p>
        </div>
      </main>
    </div>
  );
}
