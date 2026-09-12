/**
 * The logo Server Action, with its collaborators replaced: authorisation, the
 * shape of the request, the limits it enforces before any work, and what it
 * tells the form. The storage sequence itself is covered by the integration
 * suite, and the whole flow in a real browser by the end-to-end suite.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/guards", () => {
  class ForbiddenError extends Error {
    readonly status = 403;
  }
  return { assertStoreAdmin: vi.fn(), ForbiddenError };
});
vi.mock("@/lib/tenant/current", () => ({ getTenantDb: vi.fn(async () => ({ scopedClient: true })) }));
vi.mock("@/lib/tenant/logo-service", () => ({
  isLogoStorageConfigured: vi.fn(),
  replaceTenantLogo: vi.fn(),
  removeTenantLogo: vi.fn(),
  vercelBlobLogoStorage: { upload: vi.fn(), remove: vi.fn() },
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

import { refresh } from "next/cache";
import { updateLogoAction } from "@/app/[tenant]/admin/(dashboard)/settings/actions";
import { assertStoreAdmin, ForbiddenError } from "@/lib/auth/guards";
import { rateLimitStore } from "@/lib/auth/rate-limit";
import { getTenantDb } from "@/lib/tenant/current";
import { LOGO_ERRORS, LOGO_MAX_BYTES } from "@/lib/tenant/logo";
import { isLogoStorageConfigured, removeTenantLogo, replaceTenantLogo, vercelBlobLogoStorage } from "@/lib/tenant/logo-service";

const admin = { user: { id: "u-admin" }, tenant: { id: "t-acme", logoUrl: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-old.png" } };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function uploadForm(file?: Blob) {
  const form = new FormData();
  form.set("intent", "upload");
  if (file) form.set("logo", file);
  return form;
}

function removeForm() {
  const form = new FormData();
  form.set("intent", "remove");
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitStore.reset();
  vi.mocked(assertStoreAdmin).mockResolvedValue(admin as never);
  vi.mocked(isLogoStorageConfigured).mockReturnValue(true);
  vi.mocked(replaceTenantLogo).mockResolvedValue({ ok: true, logoUrl: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-new.png" });
  vi.mocked(removeTenantLogo).mockResolvedValue({ ok: true, logoUrl: null });
});

describe("updateLogoAction — who may call it", () => {
  it("refuses a caller who is not this store's admin, without touching anything", async () => {
    vi.mocked(assertStoreAdmin).mockRejectedValueOnce(new ForbiddenError("Store admin required"));
    const result = await updateLogoAction(undefined, uploadForm(new Blob([PNG])));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/session has ended/) });
    expect(getTenantDb).not.toHaveBeenCalled();
    expect(replaceTenantLogo).not.toHaveBeenCalled();
  });

  it("lets any other failure surface instead of disguising it as a sign-out", async () => {
    vi.mocked(assertStoreAdmin).mockRejectedValueOnce(new Error("database unreachable"));
    await expect(updateLogoAction(undefined, uploadForm(new Blob([PNG])))).rejects.toThrow("database unreachable");
  });
});

describe("updateLogoAction — what it accepts", () => {
  it("rejects an unknown intent", async () => {
    const form = new FormData();
    form.set("intent", "delete-everything");
    expect(await updateLogoAction(undefined, form)).toEqual({ ok: false, error: LOGO_ERRORS.missing });
    expect(replaceTenantLogo).not.toHaveBeenCalled();
    expect(removeTenantLogo).not.toHaveBeenCalled();
  });

  it("rejects an upload with no file, or an empty one", async () => {
    expect(await updateLogoAction(undefined, uploadForm())).toEqual({ ok: false, error: LOGO_ERRORS.missing });
    expect(await updateLogoAction(undefined, uploadForm(new Blob([])))).toEqual({ ok: false, error: LOGO_ERRORS.missing });
    expect(replaceTenantLogo).not.toHaveBeenCalled();
  });

  it("refuses a file over 1 MB before reading any of it into memory", async () => {
    const arrayBuffer = vi.fn();
    const oversized = { size: LOGO_MAX_BYTES + 1, arrayBuffer };
    const form = { get: (key: string) => (key === "intent" ? "upload" : key === "logo" ? oversized : null) } as unknown as FormData;

    expect(await updateLogoAction(undefined, form)).toEqual({ ok: false, error: LOGO_ERRORS.tooLarge(LOGO_MAX_BYTES + 1) });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("refuses uploads when no storage is connected", async () => {
    vi.mocked(isLogoStorageConfigured).mockReturnValue(false);
    const result = await updateLogoAction(undefined, uploadForm(new Blob([PNG])));
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/no file storage is connected/) });
    expect(replaceTenantLogo).not.toHaveBeenCalled();
  });

  it("limits each admin to 20 uploads every 15 minutes", async () => {
    for (let i = 0; i < 20; i++) expect((await updateLogoAction(undefined, uploadForm(new Blob([PNG]))))?.ok, `upload ${i + 1}`).toBe(true);
    expect(await updateLogoAction(undefined, uploadForm(new Blob([PNG])))).toEqual({ ok: false, error: expect.stringMatching(/Too many uploads/) });
  });
});

describe("updateLogoAction — results", () => {
  it("hands the bytes to the logo service with the Blob adapter and this store's client, then refreshes", async () => {
    const result = await updateLogoAction(undefined, uploadForm(new Blob([PNG])));

    expect(result).toEqual({ ok: true, message: "Logo saved. It's now showing on your storefront.", logoUrl: "https://store.public.blob.vercel-storage.com/tenants/t-acme/logo-new.png" });
    const [deps, tenant, bytes] = vi.mocked(replaceTenantLogo).mock.calls[0]!;
    expect(deps).toEqual({ db: { scopedClient: true }, storage: vercelBlobLogoStorage });
    expect(tenant).toBe(admin.tenant);
    expect([...bytes]).toEqual([...PNG]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("passes the service's own error through, and does not refresh", async () => {
    vi.mocked(replaceTenantLogo).mockResolvedValueOnce({ ok: false, error: LOGO_ERRORS.wrongType });
    expect(await updateLogoAction(undefined, uploadForm(new Blob([PNG])))).toEqual({ ok: false, error: LOGO_ERRORS.wrongType });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("removes the logo and refreshes, without needing storage to be configured", async () => {
    vi.mocked(isLogoStorageConfigured).mockReturnValue(false);
    const result = await updateLogoAction(undefined, removeForm());
    expect(result).toEqual({ ok: true, message: expect.stringMatching(/Logo removed/), logoUrl: null });
    expect(removeTenantLogo).toHaveBeenCalledWith({ db: { scopedClient: true }, storage: vercelBlobLogoStorage }, admin.tenant);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reports a failed removal without refreshing", async () => {
    vi.mocked(removeTenantLogo).mockResolvedValueOnce({ ok: false, error: "The logo couldn't be removed. Please try again." });
    expect(await updateLogoAction(undefined, removeForm())).toEqual({ ok: false, error: "The logo couldn't be removed. Please try again." });
    expect(refresh).not.toHaveBeenCalled();
  });
});
