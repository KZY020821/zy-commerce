import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The assistant package is consumed as TypeScript source from the workspace.
  transpilePackages: ["catalog-concierge"],
  // In this monorepo the lockfile and hoisted dependencies live at the repo
  // root, so Turbopack has to treat that as the workspace root.
  turbopack: { root: path.join(import.meta.dirname, "..", "..") },
  // Tenant storefronts run on *.localhost in development.
  allowedDevOrigins: ["*.localhost"],
  images: {
    remotePatterns: [
      // Vercel Blob (Phase 1 image uploads)
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      // Imported demo catalogues reference the source store's own CDN
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "static.nike.com" },
    ],
  },
};

export default nextConfig;
