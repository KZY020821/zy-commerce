/**
 * Database reachability, for the health endpoint the deployment pipeline
 * polls after every production deploy.
 *
 * It sits beside the unscoped client so that client never leaves src/lib/db:
 * `SELECT 1` reads no tenant's rows, but the rule in CLAUDE.md is about which
 * files may import `unscopedDb`, not about what a query happens to do.
 */
import { unscopedDb } from "./prisma";

export async function pingDatabase(): Promise<boolean> {
  try {
    await unscopedDb.$queryRaw`SELECT 1`;
    return true;
  } catch (err) {
    console.error("[health] database check failed", err);
    return false;
  }
}
