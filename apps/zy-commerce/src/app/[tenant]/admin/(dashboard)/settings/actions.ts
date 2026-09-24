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
export type AssistantFormState = { ok: true; message: string } | { ok: false; error: string } | undefined;

/**
 * Each upload spends one Blob operation from the monthly free allowance, and
 * the store pauses when that runs out — so one admin can't exhaust it.
 */
const UPLOADS_PER_ADMIN = { limit: 20, windowMs: 15 * 60_000 };

const SIGNED_OUT = "Your session has ended. Sign in again to change the logo.";
const SIGNED_OUT_ASSISTANT = "Your session has ended. Sign in again to change these settings.";

/** Saving is one small UPDATE, but the endpoint is public like every action. */
const SAVES_PER_ADMIN = { limit: 30, windowMs: 15 * 60_000 };

/**
 * What the store admin may tell the assistant about itself.
 *
 * `assistantPolicies` is the only source of non-product facts the model is
 * allowed to state, so it is stored as written and quoted as written; the
 * package caps how much of it reaches the prompt.
 */
const assistantSchema = z.object({
  assistantName: z.string().trim().min(1, "Give the assistant a name.").max(60, "Keep the name under 60 characters."),
  assistantGreeting: z.string().trim().max(300, "Keep the greeting under 300 characters."),
  assistantPolicies: z.string().trim().max(4000, "Keep the shop information under 4,000 characters."),
  assistantSynonyms: z.string().trim().max(500, "Keep the customer words under 500 characters."),
  supportWhatsapp: z
    .string()
    .trim()
    .max(24)
    .refine((value) => value === "" || /^\+?[0-9][0-9 ()-]{6,22}$/.test(value), "Write the WhatsApp number in international format, e.g. +60 12-345 6789."),
});

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

/**
 * One text field of a submitted form.
 *
 * Browsers send a text area's line breaks as CRLF, and this text is quoted
 * back to customers word for word, so the carriage returns are dropped here
 * rather than stored.
 */
function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.replace(/\r\n/g, "\n") : "";
}

/**
 * The assistant's own settings: what it is called, how it opens, what it may
 * say about the shop, and how a customer reaches a person instead.
 */
export async function updateAssistantAction(_prev: AssistantFormState, formData: FormData): Promise<AssistantFormState> {
  const ctx = await authorise();
  if (!ctx) return { ok: false, error: SIGNED_OUT_ASSISTANT };

  const parsed = assistantSchema.safeParse({
    assistantName: field(formData, "assistantName"),
    assistantGreeting: field(formData, "assistantGreeting"),
    assistantPolicies: field(formData, "assistantPolicies"),
    assistantSynonyms: field(formData, "assistantSynonyms"),
    supportWhatsapp: field(formData, "supportWhatsapp"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form and try again." };

  if (!checkRateLimit(`assistant-settings:${ctx.user.id}`, SAVES_PER_ADMIN).ok) return { ok: false, error: "Too many changes at once. Please wait a few minutes and try again." };

  const db = await getTenantDb();
  await db.tenant.update({
    where: { id: ctx.tenant.id },
    data: {
      assistantName: parsed.data.assistantName,
      // An empty box means "no opinion": the storefront falls back to the
      // generated greeting and the widget offers no contact at all.
      assistantGreeting: parsed.data.assistantGreeting || null,
      assistantPolicies: parsed.data.assistantPolicies || null,
      assistantSynonyms: parsed.data.assistantSynonyms || null,
      supportWhatsapp: parsed.data.supportWhatsapp || null,
    },
  });

  refresh();
  return { ok: true, message: "Saved. Your storefront assistant is using it now." };
}
