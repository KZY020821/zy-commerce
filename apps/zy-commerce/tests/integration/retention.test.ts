/**
 * The retention pass against a real Postgres: the widget promises customers
 * their chat is kept for a while, and this is what makes "a while" end.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { purgeOldConversations, retentionCutoff } from "@/lib/ai/retention";
import { unscopedDb } from "@/lib/db/prisma";
import { createTenantFixture, resetDatabase } from "./helpers";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await unscopedDb.$disconnect();
});

describe("purgeOldConversations (real database)", () => {
  it("removes the conversations past the window and leaves the rest alone", async () => {
    const { tenant } = await createTenantFixture("retention-a", "Retention A");
    const other = await createTenantFixture("retention-b", "Retention B");

    const write = async (tenantId: string, sessionToken: string, at: Date) =>
      unscopedDb.chatConversation.create({ data: { tenantId, sessionToken, messages: [{ role: "user", content: "hi" }], messageCount: 1, lastMessageAt: at } });

    const stale = await write(tenant.id, "stale-thread", daysAgo(120));
    const fresh = await write(tenant.id, "fresh-thread", daysAgo(10));
    const staleElsewhere = await write(other.tenant.id, "stale-other", daysAgo(200));

    // Two stale threads; the fixtures' own conversations are dated now.
    expect(await purgeOldConversations(unscopedDb, { now: NOW })).toBe(2);

    const left = await unscopedDb.chatConversation.findMany({ select: { id: true } });
    const ids = left.map((c) => c.id);
    expect(ids).toContain(fresh.id);
    expect(ids).not.toContain(stale.id);
    // Retention is a platform promise, not a per-store one.
    expect(ids).not.toContain(staleElsewhere.id);
  });

  it("deletes nothing when every conversation is recent", async () => {
    await createTenantFixture("retention-c", "Retention C");

    expect(await purgeOldConversations(unscopedDb, { now: NOW })).toBe(0);
    expect(await unscopedDb.chatConversation.count()).toBe(1);
  });

  it("uses the same cutoff the helper reports", async () => {
    const { tenant } = await createTenantFixture("retention-d", "Retention D");
    const cutoff = retentionCutoff(NOW);
    const justInside = await unscopedDb.chatConversation.create({
      data: { tenantId: tenant.id, sessionToken: "edge", messages: [], messageCount: 0, lastMessageAt: new Date(cutoff.getTime() + 1000) },
    });

    expect(await purgeOldConversations(unscopedDb, { now: NOW })).toBe(0);
    expect(await unscopedDb.chatConversation.findUnique({ where: { id: justInside.id } })).not.toBeNull();
  });
});
