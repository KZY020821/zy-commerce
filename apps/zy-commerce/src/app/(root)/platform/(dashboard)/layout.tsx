import Link from "next/link";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireSuperAdmin } from "@/lib/auth/guards";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSuperAdmin();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-6">
            <Link href="/platform" className="font-semibold">
              ZY Commerce <span className="text-muted-foreground">· Platform</span>
            </Link>
            <nav aria-label="Platform" className="flex items-center gap-4 text-sm">
              <Link href="/platform" className="hover:underline">
                Tenants
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-muted-foreground sm:inline">{user.email}</span>
            <SignOutButton redirectTo="/platform/login" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
