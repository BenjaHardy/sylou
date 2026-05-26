## Update `src/pages/Auth.tsx` — sign-in only + open-source notice

Rewrite the page to be sign-in only, with an "open source" notice card above the sign-in card. No changes to auth logic, Supabase calls, or routing.

### What stays
- `useAuth` guard (`loading` / redirect if `user`).
- Sylou logo at the top.
- Centered layout on `bg-[hsl(var(--ethos-surface))]`, card width `max-w-[400px]`.
- Email + password sign-in fields, icons, error display.
- `supabase.auth.signInWithPassword({ email, password })` call and `navigate("/")` on success.

### What is removed
- `AuthMode` type, `mode` state, `displayName` state.
- Tabs row (Sign In / Sign Up buttons).
- Sign-up branch of `handleSubmit` (the `signUp` call and display name field).
- `handleOAuth` function, "or continue with" divider, Google / Microsoft buttons.
- `User` icon import, `AnimatePresence` + `motion.form` wrapper (replaced by a plain `<form>` since there's no longer a mode to animate between). `User` removed from `lucide-react` import.

### What is added — notice card above sign-in
A sibling card rendered above the sign-in card inside a shared vertical flex container (`flex flex-col items-center gap-4`), so on mobile the two cards stack with comfortable spacing.

Notice card:
- Same `max-w-[400px]` width, `rounded-lg`, `border border-border`.
- Visually lighter than the sign-in card: `bg-muted/40` (or `bg-secondary/50`), no shadow, `p-5`.
- Heading: `<h2 class="text-sm font-semibold text-foreground">Sylou is open source</h2>`.
- Body: two `<p class="text-xs text-muted-foreground leading-relaxed mt-2">` paragraphs.
  - P1: "This is the maintainer's instance and is not open for public sign-up. To learn more about Sylou, visit [meetsylou.eu](https://www.meetsylou.eu)."
  - P2: "To run your own instance, see the source on [GitHub](https://github.com/)."
- Links inline, styled `text-primary hover:underline`, `target="_blank" rel="noopener noreferrer"`. GitHub URL is a placeholder per the user.

### Resulting structure (sketch)

```text
<div min-h-screen flex flex-col items-center justify-center bg-ethos-surface p-4>
  <img sylouLogo />                        // unchanged
  <div flex flex-col items-center gap-4 w-full>
    <NoticeCard max-w-[400px] />           // new
    <SignInCard max-w-[400px]>             // simplified
      <form onSubmit={handleSubmit}>
        email, password, error, submit
      </form>
    </SignInCard>
  </div>
</div>
```

No other files are touched.