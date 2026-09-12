import Link from "next/link";
import type { Tenant } from "@/generated/prisma/client";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import type { VerifiedUser } from "@/lib/auth/guards";

interface NavItem {
  href: string;
  label: string;
  /** Phase in which the section ships; undefined means available now. */
  phase?: number;
}

const NAV: NavItem[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products", phase: 1 },
  { href: "/admin/categories", label: "Categories", phase: 1 },
  { href: "/admin/orders", label: "Orders", phase: 4 },
  { href: "/admin/conversations", label: "Conversations" },
  { href: "/admin/settings", label: "Settings" },
];

export function AdminSidebar({ tenant, user }: { tenant: Tenant; user: VerifiedUser }) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 border-b px-4 py-4">
        <span aria-hidden className="inline-block size-6 rounded bg-primary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{tenant.name}</p>
          <p className="truncate text-xs text-muted-foreground">Store admin</p>
        </div>
      </div>
      <nav aria-label="Admin" className="flex-1 space-y-1 p-2">
        {NAV.map((item) =>
          item.phase ? (
            <span key={item.href} className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground" aria-disabled>
              {item.label}
              <Badge variant="outline">Phase {item.phase}</Badge>
            </span>
          ) : (
            <Link key={item.href} href={item.href} className="block rounded-md px-3 py-2 text-sm hover:bg-sidebar-accent">
              {item.label}
            </Link>
          ),
        )}
      </nav>
      <div className="space-y-2 border-t p-3 text-sm">
        <Link href="/" className="block text-muted-foreground hover:underline">
          View storefront ↗
        </Link>
        <p className="truncate text-xs text-muted-foreground" title={user.email}>
          {user.email}
        </p>
        <SignOutButton redirectTo="/admin/login" />
      </div>
    </aside>
  );
}
