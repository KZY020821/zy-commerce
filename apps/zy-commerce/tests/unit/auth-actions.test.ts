/**
 * The login and logout Server Actions: what the form sees for each outcome,
 * and that signing out can never be turned into a redirect to another site.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => {
  class AuthError extends Error {
    code?: string;
  }
  return { AuthError };
});
vi.mock("@/lib/auth/index", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));

import { AuthError } from "next-auth";
import { platformLoginAction, signOutAction, storeAdminLoginAction } from "@/lib/auth/actions";
import { signIn, signOut } from "@/lib/auth/index";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
};

function authError(code?: string) {
  const err = new AuthError() as AuthError & { code?: string };
  if (code) err.code = code;
  return err;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("login actions", () => {
  it("reject a malformed form without calling Auth.js", async () => {
    expect(await storeAdminLoginAction(undefined, form({ email: "nope", password: "x" }))).toEqual({ error: "Enter a valid email address and password." });
    expect(await storeAdminLoginAction(undefined, form({ email: "a@b.test", password: "" }))).toEqual({ error: "Enter a valid email address and password." });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("sign a store admin in with the store-admin role, then go to the dashboard", async () => {
    await expect(storeAdminLoginAction(undefined, form({ email: "admin@acme.test", password: "correct horse" }))).rejects.toThrow("REDIRECT /admin");
    expect(signIn).toHaveBeenCalledWith("credentials", { email: "admin@acme.test", password: "correct horse", role: "STORE_ADMIN", redirect: false });
  });

  it("sign a super admin in with the super-admin role, then go to the platform", async () => {
    await expect(platformLoginAction(undefined, form({ email: "owner@example.com", password: "correct horse" }))).rejects.toThrow("REDIRECT /platform");
    expect(signIn).toHaveBeenCalledWith("credentials", expect.objectContaining({ role: "SUPER_ADMIN" }));
  });

  it("tell the user to wait when rate-limited, and never say which part was wrong otherwise", async () => {
    vi.mocked(signIn).mockRejectedValueOnce(authError("rate_limited"));
    expect(await storeAdminLoginAction(undefined, form({ email: "admin@acme.test", password: "guess" }))).toEqual({ error: "Too many attempts. Please wait 15 minutes and try again." });

    vi.mocked(signIn).mockRejectedValueOnce(authError("invalid_credentials"));
    expect(await storeAdminLoginAction(undefined, form({ email: "admin@acme.test", password: "guess" }))).toEqual({ error: "Invalid email or password." });

    vi.mocked(signIn).mockRejectedValueOnce(authError());
    expect(await storeAdminLoginAction(undefined, form({ email: "admin@acme.test", password: "guess" }))).toEqual({ error: "Invalid email or password." });
  });

  it("let anything that is not an auth failure surface as an error", async () => {
    vi.mocked(signIn).mockRejectedValueOnce(new Error("database unreachable"));
    await expect(storeAdminLoginAction(undefined, form({ email: "admin@acme.test", password: "guess" }))).rejects.toThrow("database unreachable");
  });
});

describe("signOutAction", () => {
  it("returns to a path on this site", async () => {
    await signOutAction("/admin/login");
    expect(signOut).toHaveBeenCalledWith({ redirectTo: "/admin/login" });
  });

  it("refuses to send anyone to another site", async () => {
    for (const target of ["https://evil.example/", "//evil.example/", "/\\evil.example/", "javascript:alert(1)", ""]) {
      vi.mocked(signOut).mockClear();
      await signOutAction(target);
      expect(signOut, target).toHaveBeenCalledWith({ redirectTo: "/" });
    }
  });
});
