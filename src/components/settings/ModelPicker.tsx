import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  PROVIDER_LABELS,
  effectiveReasoningId,
  type ModelGroup,
  type ModelInfo,
  type ReasoningOptionsByModel,
} from "@/lib/models";

// Grouped model picker for the Settings dialog. The registry keeps growing,
// so the flat card lists became two long scrolls; each picker now folds its
// cards into titled groups (by serving API for chat, by FLOW recommendation
// for FLOW — see groupModelsByProvider / groupModelsForFlow in lib/models).
// The cards themselves are unchanged: price, badges and notes stay visible
// where the choice is made. The chat picker adds a reasoning-level select
// under the selected card (CHAT_REASONING_OPTIONS in lib/models); the FLOW
// picker passes no options and shows none.

function formatPrice(n: number): string {
  return `$${n.toFixed(2)}`;
}

function ModelOption({
  model,
  selected,
  onSelect,
  showProviderTag,
}: {
  model: ModelInfo;
  selected: boolean;
  onSelect: () => void;
  showProviderTag: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full text-left rounded-md border p-3 transition-colors ${
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/40 hover:bg-accent/30"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{model.label}</span>
          {showProviderTag && (
            <span className="text-[11px] text-muted-foreground">· {PROVIDER_LABELS[model.provider]}</span>
          )}
          {model.isRollingLatest && (
            <span className="text-[11px] text-muted-foreground">· latest version</span>
          )}
          {model.isExperimental && (
            <Badge variant="outline" className="text-[10px] py-0 h-4 px-1.5">
              experimental
            </Badge>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
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

interface ModelPickerProps {
  groups: ModelGroup[];
  selectedId: string;
  onSelect: (id: string) => void;
  /** Groups open by default even when they do not hold the selection. */
  defaultOpenGroupIds?: string[];
  /** Notice rendered at the top of a group's content, by group id. */
  groupNotices?: Record<string, ReactNode>;
  /** Show the serving API as a muted tag on each card. */
  showProviderTag?: boolean;
  /** Reasoning levels per model id, rendered as a select under the selected
   *  card; models absent from the map get no control. */
  reasoningOptions?: ReasoningOptionsByModel;
  /** The user's stored level per model id; a missing or unknown entry shows
   *  the default. */
  reasoningChoices?: Record<string, string>;
  onReasoningChange?: (modelId: string, optionId: string) => void;
}

export function ModelPicker({
  groups,
  selectedId,
  onSelect,
  defaultOpenGroupIds = [],
  groupNotices = {},
  showProviderTag = false,
  reasoningOptions,
  reasoningChoices = {},
  onReasoningChange,
}: ModelPickerProps) {
  // Only explicit toggles are stored. Until the user touches a group it is
  // open when it holds the selection (or is listed as default-open), which
  // also covers settings that arrive after the first render.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const isOpen = (group: ModelGroup): boolean =>
    toggled[group.id] ??
    (defaultOpenGroupIds.includes(group.id) || group.models.some((m) => m.id === selectedId));

  const handleSelect = (id: string) => {
    // Freeze what is on screen before the selection moves: a group that was
    // open only because it held the previous selection must not collapse
    // under the cursor.
    setToggled(Object.fromEntries(groups.map((g) => [g.id, isOpen(g)])));
    onSelect(id);
  };

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const open = isOpen(group);
        const selectedModel = group.models.find((m) => m.id === selectedId);
        return (
          <Collapsible
            key={group.id}
            open={open}
            onOpenChange={(next) => setToggled((prev) => ({ ...prev, [group.id]: next }))}
            className="rounded-md border border-border"
          >
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/30"
              >
                {open ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                )}
                <span className="text-sm font-medium text-foreground">
                  {group.label}{" "}
                  <span className="font-normal text-muted-foreground">({group.models.length})</span>
                </span>
                {!open && selectedModel && (
                  <span className="ml-auto text-[11px] text-primary">Selected: {selectedModel.label}</span>
                )}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2 px-3 pb-3">
                {groupNotices[group.id] && (
                  <div className="rounded-md bg-muted px-3 py-2 text-[11px] text-muted-foreground">
                    {groupNotices[group.id]}
                  </div>
                )}
                {group.models.map((m) => {
                  const reasoning = m.id === selectedId ? reasoningOptions?.[m.id] : undefined;
                  const current =
                    reasoning && reasoningOptions
                      ? effectiveReasoningId(m.id, reasoningChoices, reasoningOptions) ?? undefined
                      : undefined;
                  return (
                    <div key={m.id} className="space-y-1">
                      <ModelOption
                        model={m}
                        selected={m.id === selectedId}
                        onSelect={() => handleSelect(m.id)}
                        showProviderTag={showProviderTag}
                      />
                      {reasoning && (
                        <div className="flex items-center gap-2 px-3 text-[11px] text-muted-foreground">
                          <label htmlFor={`reasoning-${m.id}`}>Reasoning</label>
                          <select
                            id={`reasoning-${m.id}`}
                            className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                            value={current}
                            onChange={(e) => onReasoningChange?.(m.id, e.target.value)}
                          >
                            {reasoning.options.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.label}
                                {o.id === reasoning.defaultId ? " (default)" : ""}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
