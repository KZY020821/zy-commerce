import path from "node:path";
import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/** Hosts the demo catalogues load product photography from. */
const IMAGE_HOSTS = ["https://*.public.blob.vercel-storage.com", "https://cdn.shopify.com", "https://static.nike.com"];

/**
 * Content Security Policy.
 *
 * `script-src` still needs `'unsafe-inline'`: Next streams RSC payloads through
 * inline <script> tags, and the nonce-based alternative means generating a
 * nonce per request in `proxy.ts`, which runs on every request. That upgrade is
 * worth doing before this carries anything sensitive; until then the policy
 * earns its place through `frame-ancestors`, `object-src`, `base-uri` and
 * `form-action`, which shut down clickjacking, plugin embedding, base-tag
 * injection and cross-origin form posts regardless of inline script.
 *
 * `connect-src 'self'` is deliberate: Server Actions post back to this origin
 * and the DeepSeek call happens server-side, so the browser never needs to
 * reach the model provider.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${IMAGE_HOSTS.join(" ")}`,
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws: http://localhost:*" : ""}`,
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "manifest-src 'self'",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // Redundant with frame-ancestors for modern browsers, kept for older ones.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The assistant package is consumed as TypeScript source from the workspace.
  transpilePackages: ["catalog-concierge"],
  // In this monorepo the lockfile and hoisted dependencies live at the repo
  // root, so Turbopack has to treat that as the workspace root.
  turbopack: { root: path.join(import.meta.dirname, "..", "..") },
  // Tenant storefronts run on *.localhost in development.
  allowedDevOrigins: ["*.localhost"],
  experimental: {
    // Logo uploads (admin → Settings) send up to 1 MB plus multipart
    // overhead, over the 1 MB Server Action default. Every other action
    // still validates its own input far below this.
    serverActions: { bodySizeLimit: "2mb" },
  },
  images: {
    remotePatterns: [
      // Vercel Blob (Phase 1 image uploads)
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      // Imported demo catalogues reference the source store's own CDN
      { protocol: "https", hostname: "cdn.shopify.com" },
      { protocol: "https", hostname: "static.nike.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
