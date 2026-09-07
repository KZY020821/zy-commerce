import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "catalog-concierge",
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
