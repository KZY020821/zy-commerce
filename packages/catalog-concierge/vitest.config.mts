import { defineConfig } from "vitest/config";

/**
 * Two projects: the assistant's logic in Node, and the React widget in jsdom.
 * Neither needs a database or the network — that is the point of the package.
 *
 * Coverage is held to the floor below so a change that deletes tests fails CI.
 * The floor is a ratchet: raise it as coverage improves, never lower it.
 */
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      // `react.ts` and `index.ts` are re-export lists with nothing to execute.
      exclude: ["src/index.ts", "src/react.ts"],
      reporter: ["text-summary", "text", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        // Measured 2026-09-20: 98.22% statements, 91.36% branches, 100%
        // functions, 100% lines — each rounded down to a whole percent, except
        // functions, kept at 99 so one uncovered callback is not a failure.
        statements: 98,
        branches: 91,
        functions: 99,
        lines: 99,
      },
    },
    projects: [
      {
        extends: true,
        test: { name: "catalog-concierge", environment: "node", include: ["tests/**/*.test.ts"] },
      },
      {
        extends: true,
        test: { name: "catalog-concierge:ui", environment: "jsdom", include: ["tests/**/*.test.tsx"], setupFiles: ["tests/setup-dom.ts"] },
      },
    ],
  },
});
