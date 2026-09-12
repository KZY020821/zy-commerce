import type { Metadata } from "next";
import { LogoSettings } from "@/components/admin/logo-settings";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireStoreAdmin } from "@/lib/auth/guards";
import { isLogoStorageConfigured } from "@/lib/tenant/logo-service";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { tenant } = await requireStoreAdmin(); // re-checked per page, not just in the layout (spec §9)

  return (
    <>
      <PageHeader title="Settings" description={`How ${tenant.name} looks to customers`} />
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Store logo</CardTitle>
          <CardDescription>Shown in your storefront header. PNG, JPEG or WebP, up to 1 MB. A transparent PNG about 256 pixels tall stays sharp at every size.</CardDescription>
        </CardHeader>
        <CardContent>
          <LogoSettings storeName={tenant.name} logoUrl={tenant.logoUrl} storageConfigured={isLogoStorageConfigured()} />
        </CardContent>
      </Card>
    </>
  );
}
