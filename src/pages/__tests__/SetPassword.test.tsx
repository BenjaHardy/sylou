// Behaviour pins for the invitation / password-reset landing page: a
// template link is verified and its token scrubbed from the address bar,
// the form names the account it will change, an invalid link gets the
// notice, a token-less visit relies on an existing session, and the form
// validates before saving and continuing.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getSession: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      verifyOtp: (...args: unknown[]) => h.verifyOtp(...args),
      getSession: (...args: unknown[]) => h.getSession(...args),
      updateUser: (...args: unknown[]) => h.updateUser(...args),
    },
  },
}));

import SetPassword from "@/pages/SetPassword";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-links";

function renderPage(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/auth/set-password${search}`]}>
      <Routes>
        <Route path="/auth/set-password" element={<SetPassword />} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const newPassword = () => screen.getByPlaceholderText("New password");
const confirmPassword = () => screen.getByPlaceholderText("Confirm password");
const save = () => screen.getByRole("button", { name: "Save password and continue" });

let replaceState: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.verifyOtp.mockReset();
  h.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  h.updateUser.mockReset();
  replaceState = vi.spyOn(window.history, "replaceState");
});

afterEach(() => {
  replaceState.mockRestore();
});

describe("SetPassword page", () => {
  it("verifies a template link, scrubs the token from the address bar, and greets an invitee with the account email", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: { email: "new@example.com" }, session: null }, error: null });
    renderPage("?token_hash=abc123&type=invite");

    expect(screen.getByText("Checking your link…")).toBeInTheDocument();
    expect(await screen.findByText("Welcome to Sylou. Choose your password.")).toBeInTheDocument();
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: "abc123", type: "invite" });
    expect(screen.getByText("new@example.com")).toBeInTheDocument();
    // The history state is null in jsdom, which `expect.anything()` rejects.
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0].slice(1)).toEqual(["", window.location.pathname]);
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it("a recovery link uses the reset wording", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: { email: "ben@example.com" }, session: null }, error: null });
    renderPage("?token_hash=abc123&type=recovery");
    expect(await screen.findByText("Choose a new password.")).toBeInTheDocument();
  });

  it("a used or expired link shows the notice with a way back to sign in", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: null, session: null }, error: new Error("Token has expired") });
    renderPage("?token_hash=old&type=recovery");

    expect(await screen.findByText("This link is not valid anymore.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/auth");
    expect(screen.queryByPlaceholderText("New password")).not.toBeInTheDocument();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("without a token, an existing session is accepted and anything else is invalid", async () => {
    h.getSession.mockResolvedValue({ data: { session: { user: { email: "ben@example.com" } } } });
    const first = renderPage();
    expect(await screen.findByText("Choose a new password.")).toBeInTheDocument();
    expect(screen.getByText("ben@example.com")).toBeInTheDocument();
    expect(h.verifyOtp).not.toHaveBeenCalled();
    first.unmount();

    h.getSession.mockResolvedValue({ data: { session: null } });
    renderPage();
    expect(await screen.findByText("This link is not valid anymore.")).toBeInTheDocument();
  });

  it("the form checks length and match before calling the API, then saves and continues into the app", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: { email: "ben@example.com" }, session: null }, error: null });
    h.updateUser.mockResolvedValue({ error: null });
    renderPage("?token_hash=abc123&type=recovery");
    await screen.findByText("Choose a new password.");

    fireEvent.change(newPassword(), { target: { value: "short" } });
    fireEvent.change(confirmPassword(), { target: { value: "short" } });
    fireEvent.submit(save().closest("form")!);
    expect(await screen.findByText(`Use at least ${MIN_PASSWORD_LENGTH} characters.`)).toBeInTheDocument();
    expect(h.updateUser).not.toHaveBeenCalled();

    fireEvent.change(newPassword(), { target: { value: "long enough one" } });
    fireEvent.change(confirmPassword(), { target: { value: "long enough two" } });
    fireEvent.submit(save().closest("form")!);
    expect(await screen.findByText("The two passwords do not match.")).toBeInTheDocument();
    expect(h.updateUser).not.toHaveBeenCalled();

    fireEvent.change(confirmPassword(), { target: { value: "long enough one" } });
    fireEvent.submit(save().closest("form")!);
    await waitFor(() => expect(h.updateUser).toHaveBeenCalledWith({ password: "long enough one" }));
    expect(await screen.findByText("Home")).toBeInTheDocument();
  });

  it("a refused password change shows the provider's message and keeps the form", async () => {
    h.verifyOtp.mockResolvedValue({ data: { user: { email: "ben@example.com" }, session: null }, error: null });
    h.updateUser.mockResolvedValue({ error: new Error("Password is too weak") });
    renderPage("?token_hash=abc123&type=recovery");
    await screen.findByText("Choose a new password.");

    fireEvent.change(newPassword(), { target: { value: "long enough one" } });
    fireEvent.change(confirmPassword(), { target: { value: "long enough one" } });
    fireEvent.submit(save().closest("form")!);

    expect(await screen.findByText("Password is too weak")).toBeInTheDocument();
    expect(save()).toBeEnabled();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });
});
