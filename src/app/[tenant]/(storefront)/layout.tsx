import { StorefrontFooter } from "@/components/storefront/footer";
import { StorefrontHeader } from "@/components/storefront/header";
import { requireCurrentTenant } from "@/lib/tenant/current";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const tenant = await requireCurrentTenant();
  return (
    <>
      <StorefrontHeader tenant={tenant} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>
      <StorefrontFooter tenant={tenant} />
    </>
  );
}
