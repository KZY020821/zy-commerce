import Image from "next/image";
import Link from "next/link";
import type { Tenant } from "@/generated/prisma/client";

export function StorefrontHeader({ tenant }: { tenant: Tenant }) {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          {tenant.logoUrl ? (
            <Image src={tenant.logoUrl} alt={tenant.name} width={32} height={32} unoptimized className="h-8 w-auto" />
          ) : (
            <span aria-hidden className="inline-block size-8 rounded-md bg-primary" />
          )}
          <span>{tenant.name}</span>
        </Link>
        <nav aria-label="Store" className="flex items-center gap-5 text-sm">
          <Link href="/" className="hover:underline">
            Home
          </Link>
          <span className="text-muted-foreground" title="Cart arrives in Phase 3">
            Cart (0)
          </span>
        </nav>
      </div>
    </header>
  );
}
