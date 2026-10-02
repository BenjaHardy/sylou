// Behaviour pins for the grouped Settings model picker: which groups start
// open, the collapsed-header hint, the group notice, and that a selection
// never collapses a group under the cursor.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelPicker } from "@/components/settings/ModelPicker";
import {
  CHAT_REASONING_OPTIONS,
  FLOW_OTHER_GROUP_ID,
  FLOW_RECOMMENDED_GROUP_ID,
  groupModelsByProvider,
  groupModelsForFlow,
} from "@/lib/models";

// A group header's accessible name starts with "<label> (<count>)". Anchored
// on purpose: a model card's name can mention a group label too (GLM's note
// says "hosted on the Mistral API").
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const header = (label: string, count?: number) =>
  screen.getByRole("button", {
    name: new RegExp(`^${escapeRegExp(label)} \\(${count ?? "\\d+"}\\)`),
  });

describe("ModelPicker", () => {
  it("opens only the group that holds the selection, and hints at nothing else", () => {
    render(<ModelPicker groups={groupModelsByProvider()} selectedId="mistral-medium-3-5" onSelect={() => {}} />);

    expect(header("Mistral API", 4)).toHaveAttribute("aria-expanded", "true");
    expect(header("Anthropic (Claude)", 2)).toHaveAttribute("aria-expanded", "false");
    expect(header("Other providers", 1)).toHaveAttribute("aria-expanded", "false");

    expect(screen.getByRole("button", { name: /^Mistral Medium 3\.5/, pressed: true })).toBeInTheDocument();
    expect(screen.queryByText("Claude Opus 4.8")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Selected:/)).not.toBeInTheDocument();
  });

  it("a collapsed group that holds the selection says so in its header", () => {
    render(<ModelPicker groups={groupModelsByProvider()} selectedId="mistral-medium-3-5" onSelect={() => {}} />);

    fireEvent.click(header("Mistral API"));
    expect(header("Mistral API")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Selected: Mistral Medium 3.5")).toBeInTheDocument();
  });

  it("FLOW: recommended open by default, the other group closed, its notice shown on opening", () => {
    render(
      <ModelPicker
        groups={groupModelsForFlow()}
        selectedId="claude-sonnet-4-6"
        onSelect={() => {}}
        defaultOpenGroupIds={[FLOW_RECOMMENDED_GROUP_ID]}
        showProviderTag
        groupNotices={{ [FLOW_OTHER_GROUP_ID]: "Not currently recommended notice" }}
      />,
    );

    expect(header("Recommended for FLOW", 1)).toHaveAttribute("aria-expanded", "true");
    expect(header("Not currently recommended", 6)).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Not currently recommended notice")).not.toBeInTheDocument();
    // Provider tag on the FLOW cards.
    expect(screen.getByText("· Anthropic")).toBeInTheDocument();

    fireEvent.click(header("Not currently recommended"));
    expect(screen.getByText("Not currently recommended notice")).toBeInTheDocument();
    expect(screen.getByText("Mistral Large 3")).toBeInTheDocument();
    expect(screen.getAllByText("· Mistral API").length).toBeGreaterThan(0);
  });

  it("FLOW: a selection inside the not-recommended group opens it too", () => {
    render(
      <ModelPicker
        groups={groupModelsForFlow()}
        selectedId="claude-opus-4-8"
        onSelect={() => {}}
        defaultOpenGroupIds={[FLOW_RECOMMENDED_GROUP_ID]}
      />,
    );
    expect(header("Recommended for FLOW")).toHaveAttribute("aria-expanded", "true");
    expect(header("Not currently recommended")).toHaveAttribute("aria-expanded", "true");
  });

  it("selecting in another group reports the id and collapses nothing", () => {
    const onSelect = vi.fn();
    const groups = groupModelsByProvider();
    const { rerender } = render(<ModelPicker groups={groups} selectedId="mistral-medium-3-5" onSelect={onSelect} />);

    fireEvent.click(header("Anthropic (Claude)"));
    fireEvent.click(screen.getByRole("button", { name: /^Claude Opus 4\.8/ }));
    expect(onSelect).toHaveBeenCalledWith("claude-opus-4-8");

    // The parent applies the new selection: the group that held the old one
    // stays open instead of jumping shut.
    rerender(<ModelPicker groups={groups} selectedId="claude-opus-4-8" onSelect={onSelect} />);
    expect(header("Mistral API")).toHaveAttribute("aria-expanded", "true");
    expect(header("Anthropic (Claude)")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /^Claude Opus 4\.8/, pressed: true })).toBeInTheDocument();
  });

  it("reasoning: one select under the selected model, showing the default, reporting a change", () => {
    const onReasoningChange = vi.fn();
    render(
      <ModelPicker
        groups={groupModelsByProvider()}
        selectedId="zai-glm-5-3"
        onSelect={() => {}}
        reasoningOptions={CHAT_REASONING_OPTIONS}
        reasoningChoices={{}}
        onReasoningChange={onReasoningChange}
      />,
    );
    const select = screen.getByLabelText("Reasoning") as HTMLSelectElement;
    expect(select.value).toBe("high");
    expect(screen.getByRole("option", { name: "High (default)" })).toBeInTheDocument();
    expect(screen.getAllByRole("combobox")).toHaveLength(1);

    fireEvent.change(select, { target: { value: "max" } });
    expect(onReasoningChange).toHaveBeenCalledWith("zai-glm-5-3", "max");
  });

  it("reasoning: a stored choice is shown, an unknown one falls back to the default, and models without options get no control", () => {
    const { rerender } = render(
      <ModelPicker
        groups={groupModelsByProvider()}
        selectedId="zai-glm-5-3"
        onSelect={() => {}}
        reasoningOptions={CHAT_REASONING_OPTIONS}
        reasoningChoices={{ "zai-glm-5-3": "max" }}
        onReasoningChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Reasoning") as HTMLSelectElement).value).toBe("max");

    rerender(
      <ModelPicker
        groups={groupModelsByProvider()}
        selectedId="zai-glm-5-3"
        onSelect={() => {}}
        reasoningOptions={CHAT_REASONING_OPTIONS}
        reasoningChoices={{ "zai-glm-5-3": "turbo" }}
        onReasoningChange={() => {}}
      />,
    );
    expect((screen.getByLabelText("Reasoning") as HTMLSelectElement).value).toBe("high");

    rerender(
      <ModelPicker
        groups={groupModelsByProvider()}
        selectedId="mistral-large-2512"
        onSelect={() => {}}
        reasoningOptions={CHAT_REASONING_OPTIONS}
        reasoningChoices={{ "zai-glm-5-3": "max" }}
        onReasoningChange={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Reasoning")).not.toBeInTheDocument();
  });

  it("FLOW: without reasoning options the picker shows no control at all", () => {
    render(
      <ModelPicker
        groups={groupModelsForFlow()}
        selectedId="zai-glm-5-3"
        onSelect={() => {}}
        defaultOpenGroupIds={[FLOW_RECOMMENDED_GROUP_ID]}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
