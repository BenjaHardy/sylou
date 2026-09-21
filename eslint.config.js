import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // The two classic hooks rules, enabled explicitly rather than through
      // the plugin's `recommended` preset. Since v6 that preset also switches
      // on the React Compiler rule set (set-state-in-effect, refs, purity…),
      // which flags ~40 deliberate patterns here: state reset when a prop
      // changes, and the stable-ref pattern in the editor and save hooks.
      // Adopting those rules is a refactor to weigh on its own, not a side
      // effect of a linter upgrade. Severities match the pre-v6 preset.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      }],
      // Surfaced as a warning rather than a hard error: the remaining
      // occurrences are mostly LLM-provider response glue (see _shared/_llm.ts
      // and the edge functions) and Supabase generated-type workarounds.
      // Tracked for incremental tightening, not blocking.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    // shadcn/ui primitives are vendored as-generated; their empty interface
    // declarations (e.g. `interface X extends Y {}`) are an upstream
    // convention we deliberately don't fork.
    files: ["src/components/ui/**"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
);
