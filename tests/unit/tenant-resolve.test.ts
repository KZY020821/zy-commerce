import { describe, expect, it } from "vitest";
import { isValidTenantSlug, normalizeHostname, requestHost, RESERVED_SLUGS, resolveTenantSlug } from "@/lib/tenant/resolve";

const root = "localhost:3000";

describe("resolveTenantSlug (local root domain)", () => {
  it.each<[string | null, string | null]>([
    ["acme.localhost:3000", "acme"],
    ["ACME.localhost:3000", "acme"],
    ["acme.localhost", "acme"],
    ["acme-store.localhost:3000", "acme-store"],
    ["localhost:3000", null],
    ["localhost", null],
    ["www.localhost:3000", null],
    ["a.b.localhost:3000", null],
    ["admin.localhost:3000", null],
    ["api.localhost:3000", null],
    ["evil.com", null],
    ["acme.localhost.evil.com", null],
    ["acmelocalhost:3000", null],
    ["-bad.localhost:3000", null],
    ["ab.localhost:3000", null],
    ["", null],
    [null, null],
  ])("host %j → %j", (host, expected) => {
    expect(resolveTenantSlug(host, root)).toBe(expected);
  });
});

describe("resolveTenantSlug (production root domain)", () => {
  const prod = "zycommerce.com";
  it("resolves a tenant subdomain", () => expect(resolveTenantSlug("acme.zycommerce.com", prod)).toBe("acme"));
  it("ignores an explicit port", () => expect(resolveTenantSlug("acme.zycommerce.com:443", prod)).toBe("acme"));
  it("treats the apex as the platform root", () => expect(resolveTenantSlug("zycommerce.com", prod)).toBeNull());
  it("treats www as the platform root", () => expect(resolveTenantSlug("www.zycommerce.com", prod)).toBeNull());
  it("rejects lookalike domains", () => expect(resolveTenantSlug("acme.zycommerce.com.attacker.io", prod)).toBeNull());
});

describe("isValidTenantSlug", () => {
  it("accepts DNS-safe labels", () => {
    expect(isValidTenantSlug("acme")).toBe(true);
    expect(isValidTenantSlug("acme-store-2")).toBe(true);
    expect(isValidTenantSlug("a1b")).toBe(true);
  });
  it("rejects bad shapes", () => {
    for (const s of ["", "ab", "-acme", "acme-", "Acme", "acme_store", "acme.store", "a".repeat(64)]) {
      expect(isValidTenantSlug(s), s).toBe(false);
    }
  });
  it("rejects every reserved slug", () => {
    for (const s of RESERVED_SLUGS) expect(isValidTenantSlug(s), s).toBe(false);
  });
});

describe("normalizeHostname", () => {
  it("lower-cases, strips port and trailing dot", () => {
    expect(normalizeHostname(" Acme.Localhost:3000 ")).toBe("acme.localhost");
    expect(normalizeHostname("acme.example.com.")).toBe("acme.example.com");
  });
});

describe("requestHost", () => {
  it("prefers x-forwarded-host (first value) over host", () => {
    const h = new Headers({ host: "localhost:3000", "x-forwarded-host": "acme.localhost:3000, proxy.internal" });
    expect(requestHost(h)).toBe("acme.localhost:3000");
  });
  it("falls back to host, then null", () => {
    expect(requestHost(new Headers({ host: "acme.localhost:3000" }))).toBe("acme.localhost:3000");
    expect(requestHost(new Headers())).toBeNull();
  });
});
