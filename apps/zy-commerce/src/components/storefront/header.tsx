import Image from "next/image";
import Link from "next/link";
import type { Tenant } from "@/generated/prisma/client";

export function StorefrontHeader({ tenant }: { tenant: Tenant }) {
  return (
    <header className="border-b bg-background">
      {/* Search wraps onto its own row on small screens rather than being
          hidden. Most of this traffic arrives from a phone, and a catalogue
          with no way to search it is a dead end. */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:h-16 sm:flex-nowrap sm:py-0">
        <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold">
          {tenant.logoUrl ? (
            <Image src={tenant.logoUrl} alt={tenant.name} width={32} height={32} unoptimized className="h-8 w-auto" />
          ) : (
            <span aria-hidden className="inline-block size-8 rounded-md bg-primary" />
          )}
          <span>{tenant.name}</span>
        </Link>

        <nav aria-label="Store" className="ml-auto flex items-center gap-5 text-sm sm:order-last">
          <Link href="/" className="hover:underline">
            Shop
          </Link>
          <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground" title="This is a demonstration store — nothing here is for sale">
            Demo
          </span>
        </nav>

        <form action="/" method="get" role="search" className="order-last w-full flex-1 sm:order-none sm:w-auto">
          <input
            type="search"
            name="q"
            placeholder="Search products…"
            aria-label="Search products"
            className="w-full rounded-full border bg-background px-4 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring/50 sm:max-w-md"
          />
        </form>
      </div>
    </header>
  );
}
