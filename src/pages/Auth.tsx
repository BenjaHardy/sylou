import { useState } from "react";
import sylouLogo from "@/assets/sylou-logo.png";
import { useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, Lock } from "lucide-react";
import { SiteFooter } from "@/components/SiteFooter";
import { setPasswordRedirectUrl } from "@/lib/auth-links";

const inputClass =
  "w-full h-10 pl-10 pr-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors";
const buttonClass =
  "w-full h-10 bg-primary hover:bg-ethos-hover text-primary-foreground rounded-md text-sm font-medium transition-all duration-150 ease-ethos-ease active:scale-[0.98] disabled:opacity-50";
const linkButtonClass = "w-full text-xs text-muted-foreground hover:text-foreground hover:underline";

export default function Auth() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" replace />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  // Password reset: only existing accounts receive an email, and Supabase
  // answers the same way for unknown addresses — so the confirmation below
  // stays neutral. Registration is not possible from here (see
  // src/lib/auth-links.ts).
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: setPasswordRedirectUrl(window.location.origin),
      });
      if (error) throw error;
      setResetSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset email");
    } finally {
      setSubmitting(false);
    }
  };

  const switchMode = (next: "signin" | "reset") => {
    setMode(next);
    setError("");
    setResetSent(false);
  };

  const emailField = (
    <div className="relative">
      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoComplete="email"
        className={inputClass}
      />
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col bg-[hsl(var(--ethos-surface))]">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
      <img src={sylouLogo} alt="Sylou" className="h-16 mb-6" />
      <div className="w-full flex flex-col items-center gap-4">
        {/* Open-source notice */}
        <aside className="w-full max-w-[400px] bg-muted/40 border border-border rounded-lg p-5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Sylou is an open-source, self-hostable writing environment that makes human-AI collaboration transparent. This is the maintainer's instance and is currently not open for public sign-up.
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-3">
            To learn more about Sylou, visit{" "}
            <a
              href="https://www.meetsylou.eu"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              meetsylou.eu
            </a>
            . To run your own instance, see the source on{" "}
            <a
              href="https://github.com/BenjaHardy/sylou"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              GitHub
            </a>
            . To stay informed (occasional updates) or lend a hand, fill in the{" "}
            <a
              href="https://www.meetsylou.eu"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              short questionnaire
            </a>{" "}
            at the bottom of meetsylou.eu.
          </p>
        </aside>


        {/* Sign-in card */}
        <div className="w-full max-w-[400px] bg-card shadow-depth rounded-lg overflow-hidden">
          {mode === "signin" ? (
            <form onSubmit={handleSubmit} className="p-8 space-y-4">
              {emailField}

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="current-password"
                  className={inputClass}
                />
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <button type="submit" disabled={submitting} className={buttonClass}>
                {submitting ? "Please wait…" : "Sign In"}
              </button>

              <button type="button" onClick={() => switchMode("reset")} className={linkButtonClass}>
                Forgot password?
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="p-8 space-y-4">
              <p className="text-sm text-muted-foreground">
                Enter your email address and we will send you a link to choose a new password.
              </p>

              {emailField}

              {error && <p className="text-sm text-destructive">{error}</p>}

              {resetSent ? (
                <p className="text-sm text-foreground">
                  If an account exists for this address, an email with a reset link is on its way.
                </p>
              ) : (
                <button type="submit" disabled={submitting} className={buttonClass}>
                  {submitting ? "Please wait…" : "Send reset link"}
                </button>
              )}

              <button type="button" onClick={() => switchMode("signin")} className={linkButtonClass}>
                Back to sign in
              </button>
            </form>
          )}
        </div>
      </div>
      </div>
      <SiteFooter />
    </div>
  );
}
