import { AssistantWidget } from "@/components/storefront/assistant-widget";
import { StorefrontFooter } from "@/components/storefront/footer";
import { StorefrontHeader } from "@/components/storefront/header";
import { isAssistantConfigured } from "@/lib/ai/client";
import { getTenantDb, requireCurrentTenant } from "@/lib/tenant/current";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const tenant = await requireCurrentTenant();
  const db = await getTenantDb();
  const categories = await db.category.findMany({ where: { parentId: null }, orderBy: [{ sortOrder: "asc" }], take: 3, select: { name: true } });
  const starters = [
    "Help me choose",
    ...categories.slice(0, 2).map((c) => `Show me ${c.name.toLowerCase()}`),
    "What's on sale or in stock?",
  ].slice(0, 4);

  return (
    <>
      <StorefrontHeader tenant={tenant} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
      <StorefrontFooter tenant={tenant} />
      {tenant.assistantEnabled ? (
        <AssistantWidget
          assistantName={tenant.assistantName}
          greeting={tenant.assistantGreeting ?? `Hi! Ask me anything about the products in ${tenant.name} and I'll answer from their specifications.`}
          configured={isAssistantConfigured()}
          locale={tenant.locale}
          starterSuggestions={starters}
        />
      ) : null}
    </>
  );
}
