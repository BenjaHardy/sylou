export function SiteFooter() {
  return (
    <footer className="shrink-0 border-t border-border bg-background px-4 py-3 text-center">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        © 2026 Benjamin Hardy · Sylou™
      </p>
      <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
        Code licensed under{" "}
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          AGPL-3.0
        </a>{" "}
        · FLOW methodology under{" "}
        <a
          href="https://creativecommons.org/licenses/by-sa/4.0/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          CC BY-SA 4.0
        </a>
        .
      </p>
      <p className="text-[10px] text-muted-foreground/80 leading-relaxed mt-1">
        Substantively modified or competing versions of the Sylou software may not use the Sylou name or logo without permission. See the{" "}
        <a
          href="https://github.com/BenjaHardy/sylou/blob/main/TRADEMARK-POLICY.md"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          trademark policy
        </a>
        .
      </p>
    </footer>
  );
}
