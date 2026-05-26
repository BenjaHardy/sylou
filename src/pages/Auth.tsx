import { useState } from "react";
import sylouLogo from "@/assets/sylou-logo.png";
import { useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Mail, Lock } from "lucide-react";

export default function Auth() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[hsl(var(--ethos-surface))] p-4">
      <img src={sylouLogo} alt="Sylou" className="h-16 mb-6" />
      <div className="w-full flex flex-col items-center gap-4">
        {/* Open-source notice */}
        <aside className="w-full max-w-[400px] bg-muted/40 border border-border rounded-lg p-5">
          <h2 className="text-sm font-semibold text-foreground">Sylou is open source</h2>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            This is the maintainer's instance and is not open for public sign-up. To learn more about Sylou, visit{" "}
            <a
              href="https://www.meetsylou.eu"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              meetsylou.eu
            </a>
            .
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-2">
            To run your own instance, see the source on{" "}
            <a
              href="https://github.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              GitHub
            </a>
            .
          </p>
        </aside>

        {/* Sign-in card */}
        <div className="w-full max-w-[400px] bg-card shadow-depth rounded-lg overflow-hidden">
          <form onSubmit={handleSubmit} className="p-8 space-y-4">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full h-10 pl-10 pr-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="w-full h-10 pl-10 pr-3 bg-background border border-border rounded-md text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 bg-primary hover:bg-ethos-hover text-primary-foreground rounded-md text-sm font-medium transition-all duration-150 ease-ethos-ease active:scale-[0.98] disabled:opacity-50"
            >
              {submitting ? "Please wait…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
