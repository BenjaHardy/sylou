// Behaviour pins for the Settings dialog: a chosen model or reasoning level
// reaches the saved preferences, the FLOW picker shows its three groups and
// their notices, the Preferences tab saves the display name and the concise
// default, and account deletion is armed only by typing DELETE.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { update, settings } = vi.hoisted(() => ({
  update: vi.fn(),
  settings: {
    display_name: "Benj",
    preferred_language: "English",
    preferred_chat_model: "zai-glm-5-3",
    preferred_flow_model: "zai-glm-5-3",
    preferred_chat_reasoning: {} as Record<string, string>,
    default_concise_mode: false,
    email: "benj@example.com",
    tokens_used_this_period: 1234,
    monthly_token_budget: null as number | null,
  },
}));

vi.mock("@/hooks/useUserSettings", () => ({ useUserSettings: () => ({ settings, loading: false, update }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import { SettingsDialog } from "@/components/SettingsDialog";

// A group header's accessible name is "<label> (<count>)".
const header = (label: string) =>
  screen.getByRole("button", { name: (name) => name.startsWith(`${label} (`) });
const openTab = (name: string) => fireEvent.mouseDown(screen.getByRole("tab", { name }));

function renderDialog() {
  render(<SettingsDialog open onOpenChange={vi.fn()} />);
  return screen.getByRole("dialog");
}

// No manual DOM wipe here: the dialog renders through a portal into
// document.body, and Testing Library's own cleanup unmounts it. Wiping the
// body first makes that unmount fail on the portal node.
beforeEach(() => {
  update.mockReset();
  settings.preferred_chat_reasoning = {};
  settings.monthly_token_budget = null;
});

describe("SettingsDialog", () => {
  it("a chosen chat model and reasoning level reach the saved preferences", () => {
    renderDialog();

    // The chat picker opens the group holding the selection (GLM, Mistral API).
    expect(header("Mistral API")).toHaveAttribute("aria-expanded", "true");
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "max" } });
    expect(update).toHaveBeenCalledWith({ preferred_chat_reasoning: { "zai-glm-5-3": "max" } });

    fireEvent.click(header("Anthropic (Claude)"));
    fireEvent.click(screen.getByRole("button", { name: /^Claude Sonnet 4\.6/ }));
    expect(update).toHaveBeenCalledWith({ preferred_chat_model: "claude-sonnet-4-6" });
  });

  it("the FLOW picker shows its three groups with their notices, and a chosen model is saved", () => {
    renderDialog();

    expect(header("Recommended for FLOW")).toHaveAttribute("aria-expanded", "true");
    expect(header("Alternatives for FLOW")).toHaveAttribute("aria-expanded", "false");
    expect(header("Not currently recommended")).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header("Alternatives for FLOW"));
    expect(screen.getByText(/also produce good FLOW results/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Claude Opus 5\.5/ }));
    expect(update).toHaveBeenCalledWith({ preferred_flow_model: "claude-opus-5-5" });

    fireEvent.click(header("Not currently recommended"));
    expect(screen.getByText(/currently not recommended for FLOW analysis/)).toBeInTheDocument();
  });

  it("Preferences: the display name saves on blur, the concise default on toggle", () => {
    renderDialog();
    openTab("Preferences");

    const name = screen.getByLabelText("Display name");
    fireEvent.change(name, { target: { value: "Ben" } });
    expect(update).not.toHaveBeenCalled();
    fireEvent.blur(name);
    expect(update).toHaveBeenCalledWith({ display_name: "Ben" });

    fireEvent.click(screen.getByRole("switch"));
    expect(update).toHaveBeenCalledWith({ default_concise_mode: true });
  });

  it("Account: shows the email and the usage, and deletion is armed only by typing DELETE", () => {
    renderDialog();
    openTab("Account");

    expect(screen.getByText("benj@example.com")).toBeInTheDocument();
    expect(screen.getByText(/^1\D?234 — no limit set$/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    const confirm = screen.getByRole("alertdialog");
    expect(within(confirm).getByText("Delete account?")).toBeInTheDocument();
    const action = within(confirm)
      .getAllByRole("button")
      .find((b) => b.textContent?.trim() !== "Cancel") as HTMLButtonElement;
    expect(action).toBeDisabled();

    fireEvent.change(within(confirm).getByPlaceholderText("Type DELETE to confirm"), { target: { value: "DELETE" } });
    expect(action).toBeEnabled();
  });

  it("a capped account shows its usage against the cap", () => {
    settings.monthly_token_budget = 50000;
    renderDialog();
    openTab("Account");
    expect(screen.getByText(/^1\D?234 \/ 50\D?000 this period$/)).toBeInTheDocument();
  });
});
