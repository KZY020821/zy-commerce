/**
 * The endpoint the deployment pipeline trusts to say "the new build is live".
 * If it ever lied — cached, or reported the wrong commit — the live checks
 * would test the old build and pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: vi.fn(async () => {}) }));
vi.mock("@/lib/db/prisma", () => ({ unscopedDb: { $queryRaw: vi.fn() } }));

import { connection } from "next/server";
import { GET } from "@/app/api/health/route";
import { pingDatabase } from "@/lib/db/health";
import { unscopedDb } from "@/lib/db/prisma";

const query = vi.mocked(unscopedDb.$queryRaw);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pingDatabase", () => {
  it("is true when the database answers, false — and logged — when it does not", async () => {
    query.mockResolvedValueOnce([{ "?column?": 1 }] as never);
    expect(await pingDatabase()).toBe(true);

    query.mockRejectedValueOnce(new Error("connection refused"));
    expect(await pingDatabase()).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("GET /api/health", () => {
  it("reports the deployed commit and a reachable database, and is never cached", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "ec7acad0000000000000000000000000000000ab");
    vi.stubEnv("VERCEL_ENV", "production");
    query.mockResolvedValueOnce([] as never);

    const res = await GET();

    expect(connection).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({ ok: true, commit: "ec7acad0000000000000000000000000000000ab", environment: "production", database: "ok" });
  });

  it("answers 503 when the database is unreachable, so a broken deploy cannot pass for healthy", async () => {
    query.mockRejectedValueOnce(new Error("connection refused"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, database: "unavailable" });
  });

  it("reports no commit outside Vercel instead of an empty string", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    vi.stubEnv("VERCEL_ENV", "");
    query.mockResolvedValueOnce([] as never);
    const body = await (await GET()).json();
    expect(body.commit).toBeNull();
    expect(body.environment).toBe("test");
    expect(Date.parse(body.checkedAt)).not.toBeNaN();
  });
});
