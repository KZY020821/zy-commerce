import Image from "next/image";
import Link from "next/link";
import type { Tenant } from "@/generated/prisma/client";

export function StorefrontHeader({ tenant }: { tenant: Tenant }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          {tenant.logoUrl ? (
            <Image src={tenant.logoUrl} alt={tenant.name} width={32} height={32} unoptimized className="h-8 w-auto" />
          ) : (
            <span aria-hidden className="inline-block size-8 rounded-md bg-primary" />
          )}
          <span>{tenant.name}</span>
        </Link>
        <form action="/" method="get" role="search" className="hidden flex-1 sm:block">
          <input
            type="search"
            name="q"
            placeholder="Search products…"
            aria-label="Search products"
            className="w-full max-w-md rounded-full border bg-background px-4 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50"
          />
        </form>
        <nav aria-label="Store" className="ml-auto flex items-center gap-5 text-sm">
          <Link href="/" className="hover:underline">
            Shop
          </Link>
          <span className="text-muted-foreground" title="Cart arrives in Phase 3">
            Cart (0)
          </span>
        </nav>
      </div>
    </header>
  );
}
