// Behaviour pins for the Settings dialog: a chosen model or reasoning level
// reaches the saved preferences, the FLOW picker shows its three groups and
// their notices, the instance's local models appear in the chat picker only
// (a saved one it no longer lists stays selected, never swapped), the
// Preferences tab saves the display name and the concise default, and
// account deletion is armed only by typing DELETE.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalModel } from "@/lib/models";

const { update, settings, instance, site } = vi.hoisted(() => ({
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
  instance: { webSearchEnabled: true, localModels: [] as LocalModel[] | null, loading: false },
  site: { servedHere: true },
}));

vi.mock("@/hooks/useUserSettings", () => ({ useUserSettings: () => ({ settings, loading: false, update }) }));
vi.mock("@/hooks/useInstanceConfig", () => ({ useInstanceConfig: () => instance }));
vi.mock("@/lib/site", () => ({ isLoopbackHost: () => site.servedHere }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

const NEMO: LocalModel = { id: "ollama/sylou-nemo-16k", name: "sylou-nemo-16k", contextTokens: 16_384, tools: true };

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
  settings.preferred_chat_model = "zai-glm-5-3";
  settings.preferred_flow_model = "zai-glm-5-3";
  settings.preferred_chat_reasoning = {};
  settings.monthly_token_budget = null;
  instance.localModels = [];
  instance.loading = false;
  site.servedHere = true;
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

describe("SettingsDialog: local models", () => {
  it("an instance without local models shows no local group and no FLOW line about them", () => {
    renderDialog();
    expect(screen.queryByRole("button", { name: /^On this computer \(/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Local models can't run FLOW/)).not.toBeInTheDocument();
  });

  it("the local group comes first and open, with the Beta notice, and a picked model is saved by its id", () => {
    instance.localModels = [NEMO];
    renderDialog();

    const groups = screen.getAllByRole("button", { name: /\(\d+\)/ }).map((b) => b.textContent);
    expect(groups[0]).toMatch(/^On this computer \(1\)/);
    expect(header("On this computer")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/These models run on this computer through Ollama, not on a cloud API/)).toBeInTheDocument();
    expect(screen.getByText(/Ask, Propose and FLOW need a cloud model/)).toBeInTheDocument();
    expect(screen.queryByText(/Ollama isn't answering/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^sylou-nemo-16k/ }));
    expect(update).toHaveBeenCalledWith({ preferred_chat_model: "ollama/sylou-nemo-16k" });
  });

  it("Ollama not answering: the notice says to start it and reload the page", () => {
    instance.localModels = [{ id: NEMO.id, name: NEMO.name, notAnswering: true }];
    renderDialog();
    expect(screen.getByText(/Ollama isn't answering\. Start Ollama, then reload this page/)).toBeInTheDocument();
  });

  it("a saved local model the instance no longer lists stays selected with a warning, and nothing is saved by itself", () => {
    settings.preferred_chat_model = "ollama/sylou-gone";
    instance.localModels = [NEMO];
    renderDialog();
    expect(screen.getByRole("button", { name: /^sylou-gone/, pressed: true })).toHaveTextContent(/Not set up on this Sylou any more/);
    expect(update).not.toHaveBeenCalled();
  });

  it("the list could not be read: the saved local model says so instead of calling itself missing", () => {
    settings.preferred_chat_model = "ollama/sylou-nemo-16k";
    instance.localModels = null;
    renderDialog();
    expect(screen.getByRole("button", { name: /^sylou-nemo-16k/, pressed: true })).toHaveTextContent(/Couldn't check/);
    expect(update).not.toHaveBeenCalled();
  });

  it("the FLOW picker lists no local model and says why; a saved local FLOW model gets an alert", () => {
    instance.localModels = [NEMO];
    renderDialog();
    expect(screen.getByText(/Local models can't run FLOW analyses: FLOW always runs on a cloud model/)).toBeInTheDocument();
    fireEvent.click(header("Not currently recommended"));
    fireEvent.click(header("Alternatives for FLOW"));
    // The one sylou-nemo-16k card is the chat picker's.
    expect(screen.getAllByRole("button", { name: /^sylou-nemo-16k/ })).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a saved local FLOW model (set outside the picker): an alert to pick a cloud model", () => {
    settings.preferred_flow_model = "ollama/sylou-nemo-16k";
    renderDialog();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Your saved FLOW model, sylou-nemo-16k, is a local model, and FLOW runs on cloud models only.",
    );
  });

  it("a Sylou served from another computer: the group says the models run on its own server", () => {
    site.servedHere = false;
    instance.localModels = [NEMO];
    renderDialog();
    expect(header("On this Sylou's own server")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/These models run on this Sylou's own server through Ollama/)).toBeInTheDocument();
  });
});
