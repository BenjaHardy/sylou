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
      ...reactHooks.configs.recommended.rules,
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
