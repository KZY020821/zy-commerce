/**
 * The Vercel Blob adapter and the storage failures a store owner might see.
 * The SDK is replaced, so this checks exactly what is sent to Blob; the real
 * round trip is proven by the end-to-end suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", async (importOriginal) => ({ ...(await importOriginal<typeof import("@vercel/blob")>()), put: vi.fn(), del: vi.fn() }));

import { BlobServiceRateLimited, BlobStoreSuspendedError, del, put } from "@vercel/blob";
import { isLogoStorageConfigured, LOGO_SERVICE_ERRORS, replaceTenantLogo, vercelBlobLogoStorage, type LogoStorage } from "@/lib/tenant/logo-service";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const OWN_OLD_LOGO = "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-old.png";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("vercelBlobLogoStorage", () => {
  it("uploads publicly, under a fresh random suffix, with the type found in the bytes", async () => {
    vi.mocked(put).mockResolvedValue({ url: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-x1.png" } as never);

    const result = await vercelBlobLogoStorage.upload("tenants/t-acme/logo.png", PNG, "image/png");

    expect(result).toEqual({ url: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-x1.png" });
    const [pathname, body, options] = vi.mocked(put).mock.calls[0]!;
    expect(pathname).toBe("tenants/t-acme/logo.png");
    expect(Buffer.isBuffer(body)).toBe(true);
    expect([...(body as Buffer)]).toEqual([...PNG]);
    expect(options).toEqual({ access: "public", addRandomSuffix: true, contentType: "image/png" });
  });

  it("deletes by URL", async () => {
    await vercelBlobLogoStorage.remove(OWN_OLD_LOGO);
    expect(del).toHaveBeenCalledWith(OWN_OLD_LOGO);
  });
});

describe("isLogoStorageConfigured", () => {
  it("mirrors the SDK: a read-write token, or an OIDC token together with a store id", () => {
    expect(isLogoStorageConfigured({})).toBe(false);
    expect(isLogoStorageConfigured({ BLOB_READ_WRITE_TOKEN: "   " })).toBe(false);
    expect(isLogoStorageConfigured({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_x" })).toBe(true);
    expect(isLogoStorageConfigured({ VERCEL_OIDC_TOKEN: "oidc" })).toBe(false);
    expect(isLogoStorageConfigured({ VERCEL_OIDC_TOKEN: "oidc", BLOB_STORE_ID: "store_x" })).toBe(true);
  });
});

describe("replaceTenantLogo — storage failures a store owner might see", () => {
  const db = { tenant: { update: vi.fn(async () => ({})) } };
  const failingUpload = (err: unknown): LogoStorage => ({ upload: vi.fn(async () => Promise.reject(err)), remove: vi.fn() });

  it("says the free allowance is used up when Blob has paused the store", async () => {
    const result = await replaceTenantLogo({ db: db as never, storage: failingUpload(new BlobStoreSuspendedError()) }, { id: "t-acme", logoUrl: null }, PNG);
    expect(result).toEqual({ ok: false, error: LOGO_SERVICE_ERRORS.storagePaused });
    expect(db.tenant.update).not.toHaveBeenCalled();
  });

  it("asks for patience when Blob is rate-limiting", async () => {
    const result = await replaceTenantLogo({ db: db as never, storage: failingUpload(new BlobServiceRateLimited()) }, { id: "t-acme", logoUrl: null }, PNG);
    expect(result).toEqual({ ok: false, error: LOGO_SERVICE_ERRORS.storageBusy });
  });

  it("still succeeds when deleting the replaced file fails — that is housekeeping, not the admin's problem", async () => {
    const storage: LogoStorage = { upload: vi.fn(async () => ({ url: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-new.png" })), remove: vi.fn(async () => Promise.reject(new Error("blob down"))) };
    const result = await replaceTenantLogo({ db: db as never, storage }, { id: "t-acme", logoUrl: OWN_OLD_LOGO }, PNG);
    expect(result).toEqual({ ok: true, logoUrl: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-new.png" });
    expect(storage.remove).toHaveBeenCalledWith(OWN_OLD_LOGO);
    expect(console.error).toHaveBeenCalled();
  });
});
