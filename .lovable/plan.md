

## Fix: Ethos logo not displaying on Auth page

**Problem**: The logo `src` is set to `"/src/assets/ethos-logo.png"` — a raw filesystem path that only works in Vite's dev server, not in preview/production builds.

**Fix** (single file — `src/pages/Auth.tsx`):

1. Add an import at the top: `import ethosLogo from "@/assets/ethos-logo.png";`
2. Change line 61's `src="/src/assets/ethos-logo.png"` to `src={ethosLogo}`

This matches how assets are typically referenced elsewhere in the project and ensures Vite bundles the image correctly.

