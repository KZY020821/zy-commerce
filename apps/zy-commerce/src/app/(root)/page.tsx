import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function PlatformLanding() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">ZY Commerce</h1>
        <p className="mx-auto max-w-lg text-muted-foreground">
          Multi-tenant storefront and order management. Each store lives on its own subdomain with its own catalog, customers and orders.
        </p>
      </div>
      <Link href="/platform/login" className={buttonVariants()}>
        Platform admin
      </Link>
    </main>
  );
}
