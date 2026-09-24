/**
 * The promise the widget makes to customers — chats are kept for 90 days —
 * is only true if something deletes them.
 */
import { describe, expect, it, vi } from "vitest";
import { CHAT_RETENTION_DAYS, purgeOldConversations, retentionCutoff } from "@/lib/ai/retention";

const NOW = new Date("2026-09-20T12:00:00.000Z");

describe("retentionCutoff", () => {
  it("is the retention window before now", () => {
    expect(retentionCutoff(NOW).toISOString()).toBe("2026-06-22T12:00:00.000Z");
    expect(retentionCutoff(NOW, 1).toISOString()).toBe("2026-09-19T12:00:00.000Z");
    expect(CHAT_RETENTION_DAYS).toBe(90);
  });
});

describe("purgeOldConversations", () => {
  it("deletes only the conversations nobody has touched since then", async () => {
    const deleteMany = vi.fn(async () => ({ count: 3 }));

    expect(await purgeOldConversations({ chatConversation: { deleteMany } }, { now: NOW })).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({ where: { lastMessageAt: { lt: retentionCutoff(NOW) } } });
  });
});
