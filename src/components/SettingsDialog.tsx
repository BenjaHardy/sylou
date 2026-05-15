import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LogOut } from "lucide-react";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAuth } from "@/contexts/AuthContext";
import { MODELS, type ModelInfo } from "@/lib/models";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const LANGUAGES = [
  "English",
  "Français",
  "Español",
  "Deutsch",
  "Italiano",
  "Português",
  "Nederlands",
];

function formatPrice(n: number): string {
  return n < 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`;
}

function ModelOption({
  model,
  selected,
  onSelect,
}: {
  model: ModelInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-md border p-3 transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40 hover:bg-accent/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{model.label}</span>
          {model.isExperimental && (
            <Badge variant="outline" className="text-[10px] py-0 h-4 px-1.5">
              experimental
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          ~{formatPrice(model.pricing.input)} in · ~{formatPrice(model.pricing.output)} out
          <span className="ml-1 opacity-60">/ 1M tok</span>
        </span>
      </div>
      {model.note && (
        <p className="text-[11px] text-muted-foreground mt-1">{model.note}</p>
      )}
    </button>
  );
}

export function SettingsDialog({ open, onOpenChange }: Props) {
  const { settings, loading, update } = useUserSettings();
  const { signOut } = useAuth();

  const [displayName, setDisplayName] = useState(settings.display_name ?? "");
  useEffect(() => {
    setDisplayName(settings.display_name ?? "");
  }, [settings.display_name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage your AI models, preferences, and account.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="models" className="mt-2">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
            <TabsTrigger value="account">Account</TabsTrigger>
          </TabsList>

          {/* MODELS TAB */}
          <TabsContent value="models" className="space-y-5 mt-4">
            <div>
              <Label className="text-sm font-medium">Chat model</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Used for the chat panel and the editor's Ask / Propose actions.
              </p>
              <div className="space-y-2">
                {MODELS.map((m) => (
                  <ModelOption
                    key={m.id}
                    model={m}
                    selected={settings.preferred_chat_model === m.id}
                    onSelect={() => update({ preferred_chat_model: m.id })}
                  />
                ))}
              </div>
            </div>

            <div>
              <Label className="text-sm font-medium">FLOW analysis model</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Used when running a FLOW report on your project.
              </p>
              <div className="space-y-2">
                {MODELS.map((m) => (
                  <ModelOption
                    key={m.id}
                    model={m}
                    selected={settings.preferred_flow_model === m.id}
                    onSelect={() => update({ preferred_flow_model: m.id })}
                  />
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground italic border-t pt-3">
              Indicative provider rates as of April 2026 — shown for transparency.
              Your actual usage is metered against your Sylou token budget, not
              billed per-token at these rates. Switching models takes effect on
              your next prompt; in-flight requests finish on the previous model.
            </p>
          </TabsContent>

          {/* PREFERENCES TAB */}
          <TabsContent value="preferences" className="space-y-5 mt-4">
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => {
                  if ((displayName || null) !== settings.display_name) {
                    update({ display_name: displayName || null });
                  }
                }}
                placeholder="Your name"
              />
            </div>

            <div className="space-y-2">
              <Label>Preferred language</Label>
              <Select
                value={settings.preferred_language ?? "English"}
                onValueChange={(v) => update({ preferred_language: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <Label className="text-sm">Default to concise responses</Label>
                <p className="text-xs text-muted-foreground">
                  Initial value for the Concise toggle when you open a project.
                  You can still flip it per-session in the chat header.
                </p>
              </div>
              <Switch
                checked={settings.default_concise_mode}
                onCheckedChange={(v) => update({ default_concise_mode: v })}
              />
            </div>
          </TabsContent>

          {/* ACCOUNT TAB */}
          <TabsContent value="account" className="space-y-4 mt-4">
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Email
              </Label>
              <p className="text-sm">{settings.email || "—"}</p>
            </div>
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Subscription
              </Label>
              <p className="text-sm capitalize">{settings.subscription_tier}</p>
            </div>
            <div className="border-t pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  signOut();
                }}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign out
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {loading && (
          <p className="text-[11px] text-muted-foreground text-center mt-2">
            Loading…
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
