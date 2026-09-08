import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Lock } from "lucide-react";
import sylouLogo from "@/assets/sylou-logo.png";
import { supabase } from "@/integrations/supabase/client";
import { SiteFooter } from "@/components/SiteFooter";
import {
  MIN_PASSWORD_LENGTH,
  parseSetPasswordLink,
  type SetPasswordLinkType,
} from "@/lib/auth-links";

type Phase = "verifying" | "form" | "invalid";

/**
 * Landing page for invitation and password-reset emails (see
 * src/lib/auth-links.ts). A template link carries `token_hash` + `type`,
 * which is verified here; a default-template reset link arrives already
 * signed in (the session comes from the URL fragment), which is accepted
 * too. Either way the user ends up choosing a password and continues into
 * the app. Deliberately NOT redirecting signed-in users away: during the
 * flow the user is signed in but has no usable password yet.
 */
export default function SetPassword() {
  const location = useLocation();
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [linkType, setLinkType] = useState<SetPasswordLinkType>("recovery");
  // Shown on the form so a user who was handed someone ELSE's link (an
  // invitation or reset for another account) notices before setting a
  // password on an account that is not theirs.
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const link = parseSetPasswordLink(location.search);
      if (link) {
        setLinkType(link.type);
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
        if (cancelled) return;
        if (error) {
          setPhase("invalid");
          return;
        }
        // The one-time token is consumed now: drop it from the address bar
        // and the history entry so it cannot be re-read or leak via the URL.
        window.history.replaceState(window.history.state, "", window.location.pathname);
        setAccountEmail(data.user?.email ?? data.session?.user.email ?? null);
        setPhase("form");
        return;
      }
      // No token in the URL: a default-template reset link lands here
      // already signed in; anything else is not a valid landing.
      const { data: { session } } = await supabase.auth.getSession();
      if (cancelled) return;
      setAccountEmail(session?.user.email ?? null);
      setPhase(session ? "form" : "invalid");
    })();
    return () => {
      cancelled = true;
    };
  }, [location.search]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set the password.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full h-10 pl-10 pr-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(var(--ethos-surface))]">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
        <img src={sylouLogo} alt="Sylou" className="h-16 mb-6" />
        <div className="w-full max-w-[400px] bg-card shadow-depth rounded-lg overflow-hidden">
          {phase === "verifying" && (
            <p className="p-8 text-sm text-muted-foreground text-center">Checking your link…</p>
          )}

          {phase === "invalid" && (
            <div className="p-8 space-y-3 text-sm">
              <p className="font-medium text-foreground">This link is not valid anymore.</p>
              <p className="text-muted-foreground">
                Invitation and password-reset links can be used once and expire after a while. Open the
                most recent email again, or request a new link from the sign-in page.
              </p>
              <a href="/auth" className="inline-block text-primary hover:underline">
                Back to sign in
              </a>
            </div>
          )}

          {phase === "form" && (
            <form onSubmit={handleSubmit} className="p-8 space-y-4">
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {linkType === "invite" ? "Welcome to Sylou. Choose your password." : "Choose a new password."}
                </p>
                {accountEmail && (
                  <p className="text-xs text-muted-foreground">
                    Account: <span className="font-medium text-foreground">{accountEmail}</span>. If this is not
                    your address, close this page.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  At least {MIN_PASSWORD_LENGTH} characters. You will use it with your email address to sign in.
                </p>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  placeholder="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  className={inputClass}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-10 bg-primary hover:bg-ethos-hover text-primary-foreground rounded-md text-sm font-medium transition-all duration-150 ease-ethos-ease active:scale-[0.98] disabled:opacity-50"
              >
                {submitting ? "Please wait…" : "Save password and continue"}
              </button>
            </form>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
