import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { storeAdminLoginAction } from "@/lib/auth/actions";
import { getStoreAdmin } from "@/lib/auth/guards";
import { requireCurrentTenant } from "@/lib/tenant/current";

export const metadata: Metadata = { title: "Admin login" };

export default async function StoreAdminLoginPage() {
  const tenant = await requireCurrentTenant();
  if (await getStoreAdmin()) redirect("/admin");
  return (
    <AuthShell title={`${tenant.name} admin`} description="Sign in with your store admin account.">
      <LoginForm action={storeAdminLoginAction} />
    </AuthShell>
  );
}
