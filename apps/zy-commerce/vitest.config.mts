import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Three projects, three environments:
 *   unit        — pure logic and Server Actions with mocked framework APIs; no database
 *   component   — React components in jsdom; no database
 *   integration — real Postgres (Docker locally, a service container in CI)
 *
 * Coverage is measured across all three together (`pnpm test:coverage`) and
 * held to the floor below, so a change that deletes tests fails CI. The floor
 * is a ratchet: raise it as coverage improves, never lower it.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside a React Server environment; stub it in tests.
      "server-only": path.resolve(import.meta.dirname, "tests/mocks/server-only.ts"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      // What the unit, component and integration suites are responsible for.
      // Pages and layouts are covered by the end-to-end suite instead.
      include: ["src/lib/**/*.ts", "src/components/**/*.tsx", "src/app/**/actions.ts", "src/app/api/**/route.ts", "src/proxy.ts"],
      exclude: ["src/components/ui/**", "src/generated/**", "src/types/**"],
      reporter: ["text-summary", "text", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        // Measured 2026-09-12 across all three suites: 98.9% statements,
        // 96.06% branches, 99.3% functions, 99.43% lines. Each floor is that
        // result rounded down to a whole percent. Raise, never lower.
        statements: 98,
        branches: 96,
        functions: 99,
        lines: 99,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "component",
          environment: "jsdom",
          include: ["tests/component/**/*.test.tsx"],
          setupFiles: ["tests/component/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          setupFiles: ["tests/integration/setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
