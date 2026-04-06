import { Users } from "lucide-react";

export function CharactersPlaceholder() {
  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center space-y-3">
        <Users className="h-10 w-10 text-muted-foreground mx-auto" />
        <p className="text-sm font-medium text-foreground">Characters</p>
        <p className="text-xs text-muted-foreground">Coming soon</p>
      </div>
    </div>
  );
}
