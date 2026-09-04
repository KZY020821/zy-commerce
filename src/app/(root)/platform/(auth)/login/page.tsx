import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/login-form";
import { platformLoginAction } from "@/lib/auth/actions";
import { getSuperAdmin } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "Platform login" };

export default async function PlatformLoginPage() {
  if (await getSuperAdmin()) redirect("/platform");
  return (
    <AuthShell title="Platform admin" description="Sign in with your super-admin account.">
      <LoginForm action={platformLoginAction} />
    </AuthShell>
  );
}
