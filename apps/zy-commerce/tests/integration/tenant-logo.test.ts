/**
 * Logo changes against the real database, with storage replaced by a
 * recorder, so the whole sequence — validate, upload, save, clean up — is
 * exercised together with tenant isolation, without touching Vercel Blob.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { unscopedDb } from "@/lib/db/prisma";
import { createTenantDb } from "@/lib/db/tenant-client";
import { LOGO_ERRORS } from "@/lib/tenant/logo";
import { LOGO_SERVICE_ERRORS, removeTenantLogo, replaceTenantLogo, type LogoStorage } from "@/lib/tenant/logo-service";
import { createTenantFixture, resetDatabase, type TenantFixture } from "./helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const STORE = "https://store123.public.blob.vercel-storage.com";
const blobUrl = (tenantId: string, file: string) => `${STORE}/tenants/${tenantId}/${file}`;

/** Records every call, so each test can assert exactly what reached storage. */
function recordingStorage(opts: { failUpload?: boolean } = {}) {
  const uploads: { pathname: string; contentType: string; size: number }[] = [];
  const issued: string[] = [];
  const removed: string[] = [];
  const storage: LogoStorage = {
    async upload(pathname, bytes, contentType) {
      if (opts.failUpload) throw new Error("blob service unavailable");
      uploads.push({ pathname, contentType, size: bytes.length });
      // Mirrors the SDK's random suffix: logo.png → logo-<n>.png
      const url = `${STORE}/${pathname.replace(/\.(\w+)$/, `-${uploads.length}.$1`)}`;
      issued.push(url);
      return { url };
    },
    async remove(url) {
      removed.push(url);
    },
  };
  return { storage, uploads, issued, removed };
}

let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  await resetDatabase();
  A = await createTenantFixture("alpha", "Alpha");
  B = await createTenantFixture("beta", "Beta");
});

beforeEach(async () => {
  await unscopedDb.tenant.updateMany({ data: { logoUrl: null } });
});

afterAll(async () => {
  await unscopedDb.$disconnect();
});

const logoOf = async (tenantId: string) => (await unscopedDb.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { logoUrl: true } })).logoUrl;
const setLogo = (tenantId: string, logoUrl: string | null) => unscopedDb.tenant.update({ where: { id: tenantId }, data: { logoUrl } });

describe("replaceTenantLogo", () => {
  it("stores a valid image under the store's own folder and saves its URL", async () => {
    const { storage, uploads, issued, removed } = recordingStorage();
    const result = await replaceTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: A.tenant.id, logoUrl: null }, PNG);

    expect(result).toEqual({ ok: true, logoUrl: issued[0] });
    expect(uploads).toEqual([{ pathname: `tenants/${A.tenant.id}/logo.png`, contentType: "image/png", size: PNG.length }]);
    expect(await logoOf(A.tenant.id)).toBe(issued[0]);
    expect(removed).toEqual([]);
    expect(await logoOf(B.tenant.id)).toBeNull();
  });

  it("deletes the previous logo only after the new one is saved", async () => {
    const previous = blobUrl(A.tenant.id, "logo-old.png");
    await setLogo(A.tenant.id, previous);
    const { storage, issued, removed } = recordingStorage();

    const result = await replaceTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: A.tenant.id, logoUrl: previous }, PNG);

    expect(result).toEqual({ ok: true, logoUrl: issued[0] });
    expect(await logoOf(A.tenant.id)).toBe(issued[0]);
    expect(removed).toEqual([previous]);
  });

  it("never deletes a logo it did not upload: seeded, external, or another store's", async () => {
    for (const previous of ["https://cdn.shopify.com/s/files/logo.png", "/images/logo.png", blobUrl(B.tenant.id, "logo-b.png")]) {
      await setLogo(A.tenant.id, previous);
      const { storage, removed } = recordingStorage();
      const result = await replaceTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: A.tenant.id, logoUrl: previous }, PNG);
      expect(result.ok, previous).toBe(true);
      expect(removed, previous).toEqual([]);
    }
  });

  it("refuses a file that is not a PNG, JPEG or WebP, touching neither storage nor the database", async () => {
    const { storage, uploads } = recordingStorage();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

    const result = await replaceTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: A.tenant.id, logoUrl: null }, svg);

    expect(result).toEqual({ ok: false, error: LOGO_ERRORS.wrongType });
    expect(uploads).toEqual([]);
    expect(await logoOf(A.tenant.id)).toBeNull();
  });

  it("keeps the current logo when storage fails", async () => {
    const current = blobUrl(A.tenant.id, "logo-current.png");
    await setLogo(A.tenant.id, current);
    const { storage, removed } = recordingStorage({ failUpload: true });

    const result = await replaceTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: A.tenant.id, logoUrl: current }, PNG);

    expect(result).toEqual({ ok: false, error: LOGO_SERVICE_ERRORS.storageFailed });
    expect(await logoOf(A.tenant.id)).toBe(current);
    expect(removed).toEqual([]);
  });

  it("cannot set another store's logo, and deletes the file it uploaded for the attempt", async () => {
    // Store A's scoped client asked to update store B: the scope pins the
    // update to A, so it matches nothing and fails.
    const { storage, issued, removed } = recordingStorage();

    const result = await replaceTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: B.tenant.id, logoUrl: null }, PNG);

    expect(result).toEqual({ ok: false, error: LOGO_SERVICE_ERRORS.saveFailed });
    expect(await logoOf(B.tenant.id)).toBeNull();
    expect(await logoOf(A.tenant.id)).toBeNull();
    expect(issued).toHaveLength(1);
    expect(removed).toEqual(issued);
  });
});

describe("removeTenantLogo", () => {
  it("clears the logo and deletes the file when the store uploaded it", async () => {
    const current = blobUrl(A.tenant.id, "logo-current.png");
    await setLogo(A.tenant.id, current);
    const { storage, removed } = recordingStorage();

    const result = await removeTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: A.tenant.id, logoUrl: current });

    expect(result).toEqual({ ok: true, logoUrl: null });
    expect(await logoOf(A.tenant.id)).toBeNull();
    expect(removed).toEqual([current]);
  });

  it("clears a seeded logo without trying to delete a file it never stored", async () => {
    await setLogo(A.tenant.id, "/images/logo.png");
    const { storage, removed } = recordingStorage();

    const result = await removeTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: A.tenant.id, logoUrl: "/images/logo.png" });

    expect(result).toEqual({ ok: true, logoUrl: null });
    expect(await logoOf(A.tenant.id)).toBeNull();
    expect(removed).toEqual([]);
  });

  it("does nothing when there is no logo", async () => {
    const { storage, removed } = recordingStorage();
    const result = await removeTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: A.tenant.id, logoUrl: null });
    expect(result).toEqual({ ok: true, logoUrl: null });
    expect(removed).toEqual([]);
  });

  it("cannot clear another store's logo", async () => {
    const theirs = blobUrl(B.tenant.id, "logo-b.png");
    await setLogo(B.tenant.id, theirs);
    const { storage, removed } = recordingStorage();

    const result = await removeTenantLogo({ db: createTenantDb(A.tenant.id), storage }, { id: B.tenant.id, logoUrl: theirs });

    expect(result).toEqual({ ok: false, error: LOGO_SERVICE_ERRORS.removeFailed });
    expect(await logoOf(B.tenant.id)).toBe(theirs);
    expect(removed).toEqual([]);
  });
});
