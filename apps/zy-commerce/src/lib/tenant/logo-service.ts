import "server-only";

/**
 * Replacing and removing a store's logo.
 *
 * The order of operations is the point of this file:
 *   1. check the bytes         — nothing is stored for a file that isn't a logo
 *   2. upload the new file     — if this fails, the current logo is untouched
 *   3. point the store at it   — if this fails, the new file is deleted again
 *   4. delete the old file     — last and best effort: a leftover file costs a
 *                                few kilobytes, while deleting it first would
 *                                leave the storefront pointing at nothing
 *
 * Storage sits behind `LogoStorage` so the integration tests run this whole
 * sequence against the real database without touching Vercel Blob.
 */
import { BlobServiceRateLimited, BlobStoreSuspendedError, del, put } from "@vercel/blob";
import type { TenantDb } from "@/lib/db/tenant-client";
import { isTenantLogoBlob, logoPathname, validateLogo } from "./logo";

export interface LogoStorage {
  /** Stores the file publicly and returns the URL it is served from. */
  upload(pathname: string, bytes: Uint8Array, contentType: string): Promise<{ url: string }>;
  remove(url: string): Promise<void>;
}

/** Vercel Blob (spec §3). Credentials come from the environment; see .env.example. */
export const vercelBlobLogoStorage: LogoStorage = {
  async upload(pathname, bytes, contentType) {
    const blob = await put(pathname, Buffer.from(bytes), {
      access: "public",
      // A new URL per upload, so no browser or CDN can keep serving the old logo.
      addRandomSuffix: true,
      contentType,
    });
    return { url: blob.url };
  },
  async remove(url) {
    await del(url);
  },
};

/**
 * Whether this deployment can reach a Blob store. Mirrors the SDK's own
 * credential resolution: a read-write token, or an OIDC token with a store id.
 */
export function isLogoStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  if (env.BLOB_READ_WRITE_TOKEN?.trim()) return true;
  return Boolean(env.VERCEL_OIDC_TOKEN?.trim() && env.BLOB_STORE_ID?.trim());
}

export type LogoChange = { ok: true; logoUrl: string | null } | { ok: false; error: string };

interface LogoDeps {
  /** Must be scoped to the same tenant as `tenant` — see getTenantDb(). */
  db: TenantDb;
  storage: LogoStorage;
}

interface TenantLogo {
  id: string;
  logoUrl: string | null;
}

export const LOGO_SERVICE_ERRORS = {
  storageFailed: "The logo couldn't be stored. Please try again.",
  storagePaused: "Logo storage is paused because this month's free allowance is used up. Please try again next month.",
  storageBusy: "Too many uploads at once. Please wait a moment and try again.",
  saveFailed: "The logo couldn't be saved. Please try again.",
  removeFailed: "The logo couldn't be removed. Please try again.",
} as const;

function storageErrorMessage(err: unknown): string {
  if (err instanceof BlobStoreSuspendedError) return LOGO_SERVICE_ERRORS.storagePaused;
  if (err instanceof BlobServiceRateLimited) return LOGO_SERVICE_ERRORS.storageBusy;
  return LOGO_SERVICE_ERRORS.storageFailed;
}

/** Deleting is housekeeping: a failure is logged, never shown to the admin. */
async function removeQuietly(storage: LogoStorage, url: string): Promise<void> {
  try {
    await storage.remove(url);
  } catch (err) {
    console.error("[logo] could not delete a stored logo", url, err);
  }
}

export async function replaceTenantLogo({ db, storage }: LogoDeps, tenant: TenantLogo, bytes: Uint8Array): Promise<LogoChange> {
  const check = validateLogo(bytes);
  if (!check.ok) return check;

  let url: string;
  try {
    ({ url } = await storage.upload(logoPathname(tenant.id, check.extension), bytes, check.contentType));
  } catch (err) {
    console.error("[logo] upload failed", err);
    return { ok: false, error: storageErrorMessage(err) };
  }

  try {
    // The scoped client pins this update to the request's own tenant, so an id
    // belonging to any other store matches nothing and throws.
    await db.tenant.update({ where: { id: tenant.id }, data: { logoUrl: url } });
  } catch (err) {
    console.error("[logo] could not save the new logo", err);
    await removeQuietly(storage, url);
    return { ok: false, error: LOGO_SERVICE_ERRORS.saveFailed };
  }

  if (tenant.logoUrl && tenant.logoUrl !== url && isTenantLogoBlob(tenant.logoUrl, tenant.id)) {
    await removeQuietly(storage, tenant.logoUrl);
  }
  return { ok: true, logoUrl: url };
}

export async function removeTenantLogo({ db, storage }: LogoDeps, tenant: TenantLogo): Promise<LogoChange> {
  if (!tenant.logoUrl) return { ok: true, logoUrl: null };

  try {
    await db.tenant.update({ where: { id: tenant.id }, data: { logoUrl: null } });
  } catch (err) {
    console.error("[logo] could not remove the logo", err);
    return { ok: false, error: LOGO_SERVICE_ERRORS.removeFailed };
  }

  if (isTenantLogoBlob(tenant.logoUrl, tenant.id)) await removeQuietly(storage, tenant.logoUrl);
  return { ok: true, logoUrl: null };
}
