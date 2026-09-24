/**
 * How long a store keeps what its customers typed.
 *
 * The widget tells customers their chat is saved, so something has to make
 * that promise finite. Conversations no one has touched for `CHAT_RETENTION_DAYS`
 * are deleted; the shop keeps the recent ones it actually reads, and nobody
 * keeps a stranger's questions forever.
 *
 * Deliberately not tied to a scheduler: it is one indexed DELETE, run by the
 * seed, which every production deploy re-runs.
 */

/** The window a store's conversation log covers. */
export const CHAT_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoff(now: Date = new Date(), days: number = CHAT_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Minimal shape of the client this needs, so both clients can be passed. */
interface ConversationStore {
  chatConversation: { deleteMany(args: { where: { lastMessageAt: { lt: Date } } }): Promise<{ count: number }> };
}

/** Deletes every conversation untouched since the cutoff; returns how many. */
export async function purgeOldConversations(db: ConversationStore, options: { now?: Date; days?: number } = {}): Promise<number> {
  const { count } = await db.chatConversation.deleteMany({ where: { lastMessageAt: { lt: retentionCutoff(options.now, options.days) } } });
  return count;
}
