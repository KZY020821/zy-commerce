import { execFileSync } from "node:child_process";

/**
 * Creates this run's throwaway store and admin, and hands them to the tests
 * through the environment. The password is generated fresh for every run,
 * exists only in memory, and belongs to an account that is deleted when the
 * run ends.
 */
export default function globalSetup() {
  const output = execFileSync("pnpm", ["exec", "tsx", "tests/e2e/fixture-store.ts", "create"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const store = JSON.parse(output) as { tenantId: string; slug: string; email: string; password: string; leftovers: { stores: number; files: number } };
  if (store.leftovers.stores) console.log(`Removed ${store.leftovers.stores} store(s) and ${store.leftovers.files} file(s) left by an earlier run.`);
  process.env.E2E_TENANT_ID = store.tenantId;
  process.env.E2E_TENANT_SLUG = store.slug;
  process.env.E2E_ADMIN_EMAIL = store.email;
  process.env.E2E_ADMIN_PASSWORD = store.password;
}
