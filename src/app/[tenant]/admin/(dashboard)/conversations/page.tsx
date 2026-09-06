import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStoreAdmin } from "@/lib/auth/guards";
import { getTenantDb } from "@/lib/tenant/current";

export const metadata: Metadata = { title: "Assistant conversations" };

interface LoggedTurn {
  role: "user" | "assistant";
  content: string;
  at?: string;
  productSkus?: string[];
}

export default async function ConversationsPage() {
  const { tenant } = await requireStoreAdmin();
  const db = await getTenantDb();
  const conversations = await db.chatConversation.findMany({ orderBy: { lastMessageAt: "desc" }, take: 30 });
  const totalTurns = conversations.reduce((s, c) => s + c.messageCount, 0);

  return (
    <>
      <PageHeader title="Assistant conversations" description={`What customers asked ${tenant.assistantName} — most recent first.`} />
      {conversations.length === 0 ? (
        <p className="text-muted-foreground">No conversations yet. Open the storefront and ask the assistant something.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {conversations.length} recent {conversations.length === 1 ? "conversation" : "conversations"} · {totalTurns} messages
          </p>
          {conversations.map((c) => {
            const turns = (Array.isArray(c.messages) ? (c.messages as unknown as LoggedTurn[]) : []).slice(-8);
            return (
              <Card key={c.id}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-sm font-medium">Session {c.sessionToken.slice(0, 8)}</CardTitle>
                  <span className="text-xs text-muted-foreground">{c.lastMessageAt.toISOString().replace("T", " ").slice(0, 16)} UTC · {c.messageCount} messages</span>
                </CardHeader>
                <CardContent className="space-y-2">
                  {turns.map((t, i) => (
                    <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
                      <div className={t.role === "user" ? "max-w-[80%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" : "max-w-[80%] rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-line"}>
                        {t.content}
                        {t.productSkus && t.productSkus.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {t.productSkus.map((sku) => (
                              <Badge key={sku} variant="outline">{sku}</Badge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
