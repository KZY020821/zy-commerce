/**
 * Liveness for the deployment pipeline.
 *
 * After every production deploy, .github/workflows/deploy-verify.yml polls
 * this until `commit` equals the SHA GitHub says was deployed, then runs the
 * live smoke tests. Without it there is no way to tell "the new build is
 * serving" from "the old build is still up while the domain moves over".
 *
 * It reports nothing a visitor could not already learn: the commit is public
 * on GitHub and the environment name is not a secret. It lives under /api, so
 * the proxy never rewrites it onto a store and it answers the same on every
 * hostname.
 */
import { connection } from "next/server";
import { pingDatabase } from "@/lib/db/health";

export async function GET(): Promise<Response> {
  // Never prerendered: the answer depends on the live database.
  await connection();
  const database = await pingDatabase();

  return Response.json(
    {
      ok: database,
      commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
      database: database ? "ok" : "unavailable",
      checkedAt: new Date().toISOString(),
    },
    { status: database ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
