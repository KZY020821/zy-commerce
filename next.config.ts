import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pin the workspace root so a stray lockfile in a parent directory is ignored.
  turbopack: { root: import.meta.dirname },
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
