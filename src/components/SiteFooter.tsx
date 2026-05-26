export function SiteFooter() {
  return (
    <footer className="shrink-0 border-t border-border bg-background px-4 py-3 text-center">
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        © 2026 Benjamin Hardy. Sylou is open-source software, licensed under{" "}
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground"
        >
          AGPL-3.0
        </a>
        . The FLOW methodology is licensed under{" "}
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
      <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
        Sylou™ is a trademark of Benjamin Hardy (EUIPO application no. 019364202, pending registration).
      </p>
      <p className="text-[10px] text-muted-foreground/80 leading-relaxed mt-1">
        Forks and modified versions of the Sylou software may not use the Sylou name or logo without permission. See the{" "}
        <a href="/trademark-policy" className="underline underline-offset-2 hover:text-foreground">
          trademark policy
        </a>
        .
      </p>
    </footer>
  );
}
