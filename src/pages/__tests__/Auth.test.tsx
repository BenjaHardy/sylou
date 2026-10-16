// Behaviour pins for the sign-in page: the loading and signed-in gates, a
// sign-in that navigates home or shows the provider's message, and the
// password-reset request with its neutral confirmation.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, loading: false },
  signInWithPassword: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => h.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: (...args: unknown[]) => h.signInWithPassword(...args),
      resetPasswordForEmail: (...args: unknown[]) => h.resetPasswordForEmail(...args),
    },
  },
}));

import Auth from "@/pages/Auth";

function renderAuth() {
  return render(
    <MemoryRouter initialEntries={["/auth"]}>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<p>Home</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const email = () => screen.getByPlaceholderText("Email address");
const password = () => screen.getByPlaceholderText("Password");
const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  h.auth.user = null;
  h.auth.loading = false;
  h.signInWithPassword.mockReset();
  h.resetPasswordForEmail.mockReset();
});

describe("Auth page", () => {
  it("renders nothing while the session is being checked, and sends a signed-in user home", () => {
    h.auth.loading = true;
    const first = renderAuth();
    expect(first.container.textContent).toBe("");
    first.unmount();

    h.auth.loading = false;
    h.auth.user = { id: "u-1" };
    renderAuth();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Email address")).not.toBeInTheDocument();
  });

  it("signs in with the typed credentials and navigates home", async () => {
    h.signInWithPassword.mockResolvedValue({ error: null });
    renderAuth();

    fireEvent.change(email(), { target: { value: "ben@example.com" } });
    fireEvent.change(password(), { target: { value: "correct horse" } });
    fireEvent.click(button("Sign In"));

    await waitFor(() =>
      expect(h.signInWithPassword).toHaveBeenCalledWith({ email: "ben@example.com", password: "correct horse" }),
    );
    expect(await screen.findByText("Home")).toBeInTheDocument();
  });

  it("shows the provider's message when the sign-in is refused, and stays on the form", async () => {
    h.signInWithPassword.mockResolvedValue({ error: new Error("Invalid login credentials") });
    renderAuth();

    fireEvent.change(email(), { target: { value: "ben@example.com" } });
    fireEvent.change(password(), { target: { value: "wrong one" } });
    fireEvent.click(button("Sign In"));

    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
    expect(button("Sign In")).toBeEnabled();
    expect(screen.queryByText("Home")).not.toBeInTheDocument();
  });

  it("the reset request goes out with the set-password redirect, then a neutral confirmation replaces the button", async () => {
    h.resetPasswordForEmail.mockResolvedValue({ error: null });
    renderAuth();

    fireEvent.click(button("Forgot password?"));
    expect(screen.getByText(/send you a link to choose a new password/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Password")).not.toBeInTheDocument();

    fireEvent.change(email(), { target: { value: "ben@example.com" } });
    fireEvent.click(button("Send reset link"));

    await waitFor(() =>
      expect(h.resetPasswordForEmail).toHaveBeenCalledWith("ben@example.com", {
        redirectTo: `${window.location.origin}/auth/set-password`,
      }),
    );
    expect(await screen.findByText(/If an account exists for this address/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send reset link" })).not.toBeInTheDocument();

    // Back to sign in clears the confirmation.
    fireEvent.click(button("Back to sign in"));
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    fireEvent.click(button("Forgot password?"));
    expect(screen.queryByText(/If an account exists/)).not.toBeInTheDocument();
    expect(button("Send reset link")).toBeInTheDocument();
  });

  it("a failed reset request shows the message and keeps the button", async () => {
    h.resetPasswordForEmail.mockResolvedValue({ error: new Error("Rate limit exceeded") });
    renderAuth();

    fireEvent.click(button("Forgot password?"));
    fireEvent.change(email(), { target: { value: "ben@example.com" } });
    fireEvent.click(button("Send reset link"));

    expect(await screen.findByText("Rate limit exceeded")).toBeInTheDocument();
    expect(button("Send reset link")).toBeEnabled();
  });
});
