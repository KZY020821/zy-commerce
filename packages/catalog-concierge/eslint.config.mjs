import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // dist/ is compiled output from `pnpm build`. Its source is linted as
  // TypeScript; linting the emitted JavaScript as well only reports the
  // compiler's output against rules meant for hand-written code.
  { ignores: ["node_modules/**", "dist/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Build scripts run directly under Node.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly" } },
  },
);
