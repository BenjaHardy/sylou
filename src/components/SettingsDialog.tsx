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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { LogOut, Trash2 } from "lucide-react";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  CHAT_REASONING_OPTIONS,
  FLOW_ALTERNATIVE_GROUP_ID,
  FLOW_OTHER_GROUP_ID,
  FLOW_RECOMMENDED_GROUP_ID,
  MODEL_CONFIG_DOC_URL,
  groupModelsByProvider,
  groupModelsForFlow,
} from "@/lib/models";
import { ModelPicker } from "@/components/settings/ModelPicker";

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

// The registry is static, so the two groupings are computed once.
const CHAT_MODEL_GROUPS = groupModelsByProvider();
const FLOW_MODEL_GROUPS = groupModelsForFlow();

const modelConfigLink = (
  <a
    href={MODEL_CONFIG_DOC_URL}
    target="_blank"
    rel="noopener noreferrer"
    className="underline underline-offset-2 hover:text-foreground"
  >
    Model Configuration Reference
  </a>
);

export function SettingsDialog({ open, onOpenChange }: Props) {
  const { settings, loading, update } = useUserSettings();
  const { signOut } = useAuth();

  const [displayName, setDisplayName] = useState(settings.display_name ?? "");
  useEffect(() => {
    setDisplayName(settings.display_name ?? "");
  }, [settings.display_name]);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deleteArmed = deleteConfirm.trim().toUpperCase() === "DELETE";

  const handleDeleteAccount = async () => {
    setDeleting(true);
    const { error } = await supabase.functions.invoke("delete-account");
    if (error) {
      setDeleting(false);
      toast({
        title: "Account deletion failed",
        description: "Your account was not deleted. Please try again.",
        variant: "destructive",
      });
      return;
    }
    // The account is gone server-side. Clear the local session only (a
    // server sign-out would fail — the user no longer exists) and
    // hard-reload so no in-memory state survives.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    window.location.assign("/auth");
  };

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
              <Label className="text-sm font-semibold text-primary">Chat model</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Used for the chat panel and the editor's Ask / Propose actions. The reasoning
                level under the selected model applies to those two as well; editor actions and
                document summaries use the selected model with fixed settings.
              </p>
              <ModelPicker
                groups={CHAT_MODEL_GROUPS}
                selectedId={settings.preferred_chat_model}
                onSelect={(id) => update({ preferred_chat_model: id })}
                reasoningOptions={CHAT_REASONING_OPTIONS}
                reasoningChoices={settings.preferred_chat_reasoning}
                onReasoningChange={(modelId, optionId) =>
                  update({
                    preferred_chat_reasoning: { ...settings.preferred_chat_reasoning, [modelId]: optionId },
                  })
                }
              />
            </div>

            <div>
              <Label className="text-sm font-semibold text-primary">FLOW analysis model</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Used when running a FLOW report on your project. Its reasoning settings are fixed
                in code (see the {modelConfigLink}).
              </p>
              <ModelPicker
                groups={FLOW_MODEL_GROUPS}
                selectedId={settings.preferred_flow_model}
                onSelect={(id) => update({ preferred_flow_model: id })}
                defaultOpenGroupIds={[FLOW_RECOMMENDED_GROUP_ID]}
                showProviderTag
                groupNotices={{
                  [FLOW_ALTERNATIVE_GROUP_ID]: (
                    <>
                      These models also produce good FLOW results, but the recommended models
                      offer a better mix of reliability, speed and cost. See the {modelConfigLink} for details.
                    </>
                  ),
                  [FLOW_OTHER_GROUP_ID]: (
                    <>
                      These models are currently not recommended for FLOW analysis, because of
                      reliability, speed or cost constraints. See the {modelConfigLink} for details.
                      These lists may change as testing continues.
                    </>
                  ),
                }}
              />
            </div>

            <p className="text-[11px] text-muted-foreground italic border-t pt-3">
              Indicative provider rates as of October 2026 — shown for transparency.
              Switching models takes effect on your next prompt; in-flight
              requests finish on the previous model.
            </p>
            <p className="text-[11px] text-muted-foreground italic">
              See the {modelConfigLink} on GitHub for details on
              model configurations and behavior across functions.
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
                Token usage
              </Label>
              <p className="text-sm tabular-nums">
                {settings.monthly_token_budget === null
                  ? `${settings.tokens_used_this_period.toLocaleString()} — no limit set`
                  : `${settings.tokens_used_this_period.toLocaleString()} / ${settings.monthly_token_budget.toLocaleString()} this period`}
              </p>
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

            <div className="border-t pt-4 space-y-2">
              <p className="text-sm font-medium text-destructive">Danger zone</p>
              <p className="text-xs text-muted-foreground">
                Permanently delete your account and all of your data —
                projects, writing, chat history, FLOW reports, and imported
                files. Links to reports you have shared stop working. This
                cannot be undone.
              </p>
              <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete account
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {loading && (
          <p className="text-[11px] text-muted-foreground text-center mt-2">
            Loading…
          </p>
        )}

        {/* Account-deletion confirmation (portals to body; nesting is fine) */}
        <AlertDialog
          open={deleteOpen}
          onOpenChange={(v) => {
            if (deleting) return; // no closing mid-request
            setDeleteOpen(v);
            if (!v) setDeleteConfirm("");
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently erases your account and everything in it —
                projects, writing, chat history, FLOW reports, and imported
                files. Links to reports you have shared stop working. This
                cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Type DELETE to confirm"
              disabled={deleting}
              autoFocus
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={!deleteArmed || deleting}
                onClick={(e) => {
                  e.preventDefault(); // keep the dialog open while the request runs
                  handleDeleteAccount();
                }}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? "Deleting…" : "Delete my account"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
