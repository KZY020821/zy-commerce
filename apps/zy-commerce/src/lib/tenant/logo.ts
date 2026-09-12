/**
 * Store logo rules (spec §7.7).
 *
 * Pure — no storage, no database, no `server-only` — so the same limits drive
 * the upload form's instant feedback and the Server Action's real check, and
 * every rule is unit tested without infrastructure.
 */

/** 1 MB. Already far more than a 32px-tall header logo needs. */
export const LOGO_MAX_BYTES = 1024 * 1024;

export const LOGO_TYPES = {
  png: { contentType: "image/png", extension: "png" },
  jpeg: { contentType: "image/jpeg", extension: "jpg" },
  webp: { contentType: "image/webp", extension: "webp" },
} as const;

export type LogoType = keyof typeof LOGO_TYPES;

/**
 * Offered to the file picker so it only shows images. A convenience, not a
 * check: the server identifies the file from its bytes.
 */
export const LOGO_ACCEPT = Object.values(LOGO_TYPES)
  .map((t) => t.contentType)
  .join(",");

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function hasBytesAt(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

/**
 * Identifies an image from its leading bytes. The file name and the MIME type
 * the browser reports are both chosen by the uploader, so neither is trusted.
 *
 * SVG is deliberately not recognised: an SVG can carry script, and a public
 * store serves it to anyone who opens its URL.
 */
export function detectLogoType(bytes: Uint8Array): LogoType | null {
  if (hasBytesAt(bytes, PNG_SIGNATURE)) return "png";
  if (hasBytesAt(bytes, JPEG_SIGNATURE)) return "jpeg";
  // "RIFF", a 4-byte length, then "WEBP".
  if (hasBytesAt(bytes, RIFF) && hasBytesAt(bytes, WEBP, 8)) return "webp";
  return null;
}

/** "340 KB", "1.4 MB" — for messages a store owner reads. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const LOGO_ERRORS = {
  missing: "Choose an image file to upload.",
  tooLarge: (bytes: number) => `The logo must be 1 MB or smaller — this file is ${formatBytes(bytes)}.`,
  wrongType: "Upload a PNG, JPEG or WebP image.",
} as const;

export type LogoValidation =
  | { ok: true; type: LogoType; contentType: string; extension: string }
  | { ok: false; error: string };

export function validateLogo(bytes: Uint8Array): LogoValidation {
  if (bytes.length === 0) return { ok: false, error: LOGO_ERRORS.missing };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: LOGO_ERRORS.tooLarge(bytes.length) };
  const type = detectLogoType(bytes);
  if (!type) return { ok: false, error: LOGO_ERRORS.wrongType };
  return { ok: true, type, ...LOGO_TYPES[type] };
}

/**
 * Where a tenant's logos live in the store. The SDK appends a random suffix,
 * so every upload gets a fresh URL and no browser or CDN can serve a stale one.
 */
export function logoPathname(tenantId: string, extension: string): string {
  return `tenants/${tenantId}/logo.${extension}`;
}

/**
 * True only for a logo this tenant uploaded to Vercel Blob.
 *
 * Replacing or removing a logo deletes the old file, but `logoUrl` is only a
 * column — it can be seeded, or set by hand — so it is never trusted as ours
 * to delete. A seeded image, another site's URL, or another tenant's file all
 * return false and are left alone.
 */
export function isTenantLogoBlob(url: string | null | undefined, tenantId: string): boolean {
  if (!url || !tenantId) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(".public.blob.vercel-storage.com") &&
    parsed.pathname.startsWith(`/tenants/${tenantId}/`)
  );
}
