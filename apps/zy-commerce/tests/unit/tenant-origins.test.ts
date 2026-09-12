import { afterEach, describe, expect, it, vi } from "vitest";
import { getRootDomain, parseHostAliases, platformOrigin, tenantOrigin } from "@/lib/tenant/resolve";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getRootDomain", () => {
  it("defaults to localhost:3000 when unset, and normalises what is set", () => {
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", undefined);
    expect(getRootDomain()).toBe("localhost:3000");
    vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "  ZyCommerce.COM ");
    expect(getRootDomain()).toBe("zycommerce.com");
  });
});

describe("origins", () => {
  it("uses http only for local development hosts", () => {
    expect(platformOrigin("localhost:3000")).toBe("http://localhost:3000");
    expect(platformOrigin("zycommerce.com")).toBe("https://zycommerce.com");
    expect(tenantOrigin("acme", "localhost:3000", new Map())).toBe("http://acme.localhost:3000");
    expect(tenantOrigin("acme", "zycommerce.com", new Map())).toBe("https://acme.zycommerce.com");
  });

  it("reads aliases from the environment by default", () => {
    vi.stubEnv("TENANT_HOST_ALIASES", "demo=zy-commerce-demo.vercel.app");
    expect(parseHostAliases().get("zy-commerce-demo.vercel.app")).toBe("demo");
    expect(tenantOrigin("demo", "zy-commerce.vercel.app")).toBe("https://zy-commerce-demo.vercel.app");
  });
});
