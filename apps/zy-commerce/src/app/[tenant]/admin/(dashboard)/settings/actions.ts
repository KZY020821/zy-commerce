"use server";

/**
 * Store settings Server Actions.
 *
 * A Server Action is a public POST endpoint whether or not the page that
 * renders its form is protected, so this authorises on every call rather than
 * trusting that only an admin could have seen the form.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { assertStoreAdmin, ForbiddenError } from "@/lib/auth/guards";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import { getTenantDb } from "@/lib/tenant/current";
import { LOGO_ERRORS, LOGO_MAX_BYTES } from "@/lib/tenant/logo";
import { isLogoStorageConfigured, removeTenantLogo, replaceTenantLogo, vercelBlobLogoStorage } from "@/lib/tenant/logo-service";

export type LogoFormState = { ok: true; message: string; logoUrl: string | null } | { ok: false; error: string } | undefined;

/**
 * Each upload spends one Blob operation from the monthly free allowance, and
 * the store pauses when that runs out — so one admin can't exhaust it.
 */
const UPLOADS_PER_ADMIN = { limit: 20, windowMs: 15 * 60_000 };

const SIGNED_OUT = "Your session has ended. Sign in again to change the logo.";

/**
 * An uploaded file, checked by shape rather than `instanceof File`: the class
 * a multipart parser produces is not guaranteed to be the same global the
 * check would compare against.
 */
function isUploadedFile(value: unknown): value is Blob {
  return typeof value === "object" && value !== null && typeof (value as Blob).arrayBuffer === "function" && typeof (value as Blob).size === "number";
}

const logoRequestSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("upload"), logo: z.custom<Blob>(isUploadedFile) }),
  z.object({ intent: z.literal("remove") }),
]);

async function authorise() {
  try {
    return await assertStoreAdmin();
  } catch (err) {
    if (err instanceof ForbiddenError) return null;
    throw err;
  }
}

export async function updateLogoAction(_prev: LogoFormState, formData: FormData): Promise<LogoFormState> {
  const ctx = await authorise();
  if (!ctx) return { ok: false, error: SIGNED_OUT };

  const parsed = logoRequestSchema.safeParse({ intent: formData.get("intent"), logo: formData.get("logo") });
  if (!parsed.success) return { ok: false, error: LOGO_ERRORS.missing };

  const db = await getTenantDb();

  if (parsed.data.intent === "remove") {
    const result = await removeTenantLogo({ db, storage: vercelBlobLogoStorage }, ctx.tenant);
    if (!result.ok) return result;
    refresh();
    return { ok: true, message: "Logo removed. Your storefront shows the coloured square again.", logoUrl: null };
  }

  if (!isLogoStorageConfigured()) return { ok: false, error: "Logo uploads aren't available: no file storage is connected to this deployment." };
  if (!checkRateLimit(`logo:${ctx.user.id}`, UPLOADS_PER_ADMIN).ok) return { ok: false, error: "Too many uploads. Please wait a few minutes and try again." };

  const file = parsed.data.logo;
  if (file.size === 0) return { ok: false, error: LOGO_ERRORS.missing };
  // Refused before anything is read into memory.
  if (file.size > LOGO_MAX_BYTES) return { ok: false, error: LOGO_ERRORS.tooLarge(file.size) };

  const result = await replaceTenantLogo({ db, storage: vercelBlobLogoStorage }, ctx.tenant, new Uint8Array(await file.arrayBuffer()));
  if (!result.ok) return result;
  refresh();
  return { ok: true, message: "Logo saved. It's now showing on your storefront.", logoUrl: result.logoUrl };
}
