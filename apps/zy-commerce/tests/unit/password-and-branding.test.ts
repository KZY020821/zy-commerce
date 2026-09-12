import { describe, expect, it } from "vitest";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "@/lib/auth/password";
import { contrastingTextColor, isHexColor, relativeLuminance, tenantCssVars } from "@/lib/tenant/branding";

describe("password hashing", () => {
  it("verifies the password it hashed, and nothing else", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt at cost 12
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
  });

  it("salts every hash, so two users with one password never share a hash", async () => {
    expect(await hashPassword("same password")).not.toBe(await hashPassword("same password"));
  });

  it("answers no for a missing account, after doing the same amount of work", async () => {
    expect(await verifyPassword("anything", null)).toBe(false);
    expect(await verifyPassword("anything", undefined)).toBe(false);
  });

  it("keeps the documented length bounds", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });
});

describe("store branding", () => {
  it("accepts only 3- or 6-digit hex colours", () => {
    for (const ok of ["#fff", "#FFF", "#0f172a", "#0F172A"]) expect(isHexColor(ok), ok).toBe(true);
    for (const bad of ["fff", "#ffff", "#12345g", "red", "", "#0f172a; background:url(x)"]) expect(isHexColor(bad), bad).toBe(false);
  });

  it("computes WCAG luminance, treating short and long hex alike", () => {
    expect(relativeLuminance("#000000")).toBe(0);
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 10);
    expect(relativeLuminance("#fff")).toBe(relativeLuminance("#ffffff"));
  });

  it("puts readable text on the store's colour", () => {
    expect(contrastingTextColor("#111111")).toBe("#ffffff");
    expect(contrastingTextColor("#fafafa")).toBe("#111111");
  });

  it("drives the theme from the store's colour", () => {
    expect(tenantCssVars({ primaryColor: "#111111" })).toEqual({
      "--primary": "#111111",
      "--primary-foreground": "#ffffff",
      "--ring": "#111111",
      "--sidebar-primary": "#111111",
      "--sidebar-primary-foreground": "#ffffff",
    });
  });

  it("falls back to the default colour instead of injecting arbitrary CSS", () => {
    const vars = tenantCssVars({ primaryColor: "red; background: url(//evil.example)" }) as Record<string, string>;
    expect(vars["--primary"]).toBe("#0f172a");
  });
});
