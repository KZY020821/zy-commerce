import type { Tenant } from "@/generated/prisma/client";

/**
 * The demo disclaimer is not decoration. These storefronts are built from the
 * public catalogues of real shops and show their brand names, product names
 * and photography, so the page has to say plainly what it is, who it is not,
 * and that nothing on it is for sale.
 */
export function StorefrontFooter({ tenant }: { tenant: Tenant }) {
  return (
    <footer className="border-t bg-muted/30">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 text-sm text-muted-foreground">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p>
            {tenant.name}
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
        <p className="max-w-3xl text-xs leading-relaxed">
          <strong className="font-medium text-foreground">Demonstration store.</strong> Built to show the Catalog
          Concierge chat assistant working on a real product catalogue. It is not a shop: nothing here is for sale and
          no order can be placed. It is not affiliated with, endorsed by, or connected to any brand shown. Product
          names, images and specifications were taken from publicly available catalogue data and remain the property of
          their respective owners. Prices are illustrative and may be out of date.
        </p>
      </div>
    </footer>
  );
}
