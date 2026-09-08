import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { platformOrigin } from "@/lib/tenant/resolve";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const TITLE = "ZY Commerce";
const DESCRIPTION = "A chat assistant that answers customer questions from a store's own catalogue — real prices, real stock, and the right question back.";

export const metadata: Metadata = {
  // Absolute URLs for the link preview. Tenant storefronts override this with
  // their own origin in app/[tenant]/layout.tsx.
  metadataBase: new URL(platformOrigin()),
  title: { default: TITLE, template: `%s · ${TITLE}` },
  description: DESCRIPTION,
  applicationName: TITLE,
  // See app/robots.ts: the demos carry other companies' brand and product
  // names, so they are shared by link, never indexed.
  robots: { index: false, follow: false },
  openGraph: { type: "website", siteName: TITLE, title: TITLE, description: DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
