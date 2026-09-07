import type { Tenant } from "@/generated/prisma/client";

export function StorefrontFooter({ tenant }: { tenant: Tenant }) {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} {tenant.name}
          {tenant.contactEmail ? (
            <>
              {" · "}
              <a href={`mailto:${tenant.contactEmail}`} className="hover:underline">
                {tenant.contactEmail}
              </a>
            </>
          ) : null}
        </p>
        <p>Powered by ZY Commerce</p>
      </div>
    </footer>
  );
}
