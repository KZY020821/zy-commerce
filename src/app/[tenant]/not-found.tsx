import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function TenantNotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-sm font-medium text-muted-foreground">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">Not found</h1>
      <p className="max-w-md text-muted-foreground">That page or product isn&apos;t available in this store.</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        Back to store
      </Link>
    </main>
  );
}
