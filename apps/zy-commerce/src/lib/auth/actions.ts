"use server";

/**
 * Login / logout Server Actions. Input is validated with Zod before it reaches
 * Auth.js; Auth.js validates again inside `authorize`.
 */
import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { z } from "zod";
import { UserRole } from "@/generated/prisma/enums";
import { signIn, signOut } from "./index";

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
});

export type LoginState = { error?: string } | undefined;

async function login(role: UserRole, redirectTo: string, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: "Enter a valid email address and password." };

  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      role,
      redirect: false,
    });
  } catch (err) {
    if (err instanceof AuthError) {
      const code = "code" in err ? (err as { code?: string }).code : undefined;
      if (code === "rate_limited") return { error: "Too many attempts. Please wait 15 minutes and try again." };
      return { error: "Invalid email or password." };
    }
    throw err;
  }

  redirect(redirectTo);
}

export async function platformLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  return login(UserRole.SUPER_ADMIN, "/platform", formData);
}

export async function storeAdminLoginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  return login(UserRole.STORE_ADMIN, "/admin", formData);
}

/**
 * Only a same-site path is accepted. "//host" also starts with a slash but a
 * browser reads it as another site, and a bound Server Action argument comes
 * back from the client, so it is never trusted as-is.
 */
export async function signOutAction(redirectTo: string): Promise<void> {
  const sameSite = redirectTo.startsWith("/") && !redirectTo.startsWith("//") && !redirectTo.startsWith("/\\");
  await signOut({ redirectTo: sameSite ? redirectTo : "/" });
}
