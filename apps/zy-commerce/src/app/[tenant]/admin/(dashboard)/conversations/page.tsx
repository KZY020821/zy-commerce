import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { summariseConversations } from "@/lib/ai/insights";
import { requireStoreAdmin } from "@/lib/auth/guards";
import { getTenantDb } from "@/lib/tenant/current";

export const metadata: Metadata = { title: "Assistant conversations" };

interface LoggedTurn {
  role: "user" | "assistant";
  content: string;
  at?: string;
  productSkus?: string[];
  rating?: "up" | "down";
}

/** A ranked list, or nothing at all when there is nothing to rank. */
function Ranked({ title, description, items }: { title: string; description: string; items: { text: string; count: number }[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.text} className="flex items-baseline justify-between gap-3 border-b py-1 last:border-0">
              <span className="min-w-0 truncate">{item.text}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{item.count}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export default async function ConversationsPage() {
  const { tenant } = await requireStoreAdmin();
  const db = await getTenantDb();
  // The summary reads further back than the transcripts below it: a shop owner
  // reads a handful of conversations, but counts only mean something in bulk.
  const conversations = await db.chatConversation.findMany({ orderBy: { lastMessageAt: "desc" }, take: 200 });
  const insights = summariseConversations(conversations);
  const recent = conversations.slice(0, 30);
  const totalTurns = conversations.reduce((s, c) => s + c.messageCount, 0);

  // Every product the assistant showed, so the list can say what they are.
  const shown = await db.product.findMany({ where: { sku: { in: insights.topProducts.map((p) => p.sku) } }, select: { sku: true, name: true } });
  const productName = new Map(shown.map((p) => [p.sku, p.name]));

  return (
    <>
      <PageHeader title="Assistant conversations" description={`What customers asked ${tenant.assistantName} — most recent first.`} />
      {conversations.length === 0 ? (
        <p className="text-muted-foreground">No conversations yet. Open the storefront and ask the assistant something.</p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">{insights.conversations}</p>
                <p className="text-sm text-muted-foreground">conversations · {totalTurns} messages</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">{insights.refused}</p>
                <p className="text-sm text-muted-foreground">turned away as off-topic</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">
                  {insights.ratedUp} <span className="text-base font-normal text-muted-foreground">helpful</span>
                </p>
                <p className="text-sm text-muted-foreground">{insights.ratedDown} marked unhelpful</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-2xl font-semibold">{insights.topProducts.length}</p>
                <p className="text-sm text-muted-foreground">products it recommended</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Ranked title="What customers ask most" description="The same question, however it was worded." items={insights.topQuestions} />
            <Ranked title="What it would not answer" description="Turned away before it reached the model. If real questions are here, they belong in Settings → Assistant." items={insights.refusedQuestions} />
            <Ranked
              title="Products it puts in front of people"
              description="Counted from the cards it attached to its answers."
              items={insights.topProducts.map((p) => ({ text: productName.get(p.sku) ?? p.sku, count: p.count }))}
            />
            {insights.unhelpful.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium">Answers customers marked unhelpful</CardTitle>
                  <CardDescription>The clearest signal you have of where it is falling short.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {insights.unhelpful.map((exchange, i) => (
                    <div key={i} className="border-b pb-2 last:border-0 last:pb-0">
                      <p className="font-medium">{exchange.question || "(no question recorded)"}</p>
                      <p className="mt-1 line-clamp-3 text-muted-foreground">{exchange.answer}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>

          <p className="pt-2 text-sm text-muted-foreground">
            Most recent {recent.length === 1 ? "conversation" : `${recent.length} conversations`}, newest first
          </p>
          {recent.map((c) => {
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
                        {t.rating ? <span className="ml-2 align-middle text-xs text-muted-foreground">{t.rating === "up" ? "· marked helpful" : "· marked unhelpful"}</span> : null}
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
