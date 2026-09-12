/**
 * The health check against a real Postgres: what the deployment pipeline
 * polls must really reach the database, not just return a constant.
 */
import { afterAll, describe, expect, it } from "vitest";
import { pingDatabase } from "@/lib/db/health";
import { unscopedDb } from "@/lib/db/prisma";

afterAll(async () => {
  await unscopedDb.$disconnect();
});

describe("pingDatabase (real database)", () => {
  it("reaches the database", async () => {
    expect(await pingDatabase()).toBe(true);
  });
});
