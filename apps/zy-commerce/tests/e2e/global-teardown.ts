import { execFileSync } from "node:child_process";

/** Deletes this run's store, its admin, and every file it uploaded. */
export default function globalTeardown() {
  const output = execFileSync("pnpm", ["exec", "tsx", "tests/e2e/fixture-store.ts", "destroy"], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
  const { stores, files } = JSON.parse(output) as { stores: number; files: number };
  console.log(`Cleaned up ${stores} test store(s) and ${files} uploaded file(s).`);
}
