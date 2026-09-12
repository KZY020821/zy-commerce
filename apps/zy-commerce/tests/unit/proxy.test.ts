/**
 * The proxy decides which store every request belongs to, so it is tested the
 * way the platform runs it: a request in, a rewrite or pass-through out.
 * Headers the proxy hands to the app travel as `x-middleware-request-*`.
 */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, proxy, TENANT_SLUG_HEADER } from "@/proxy";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", "localhost:3000");
  vi.stubEnv("TENANT_HOST_ALIASES", "demo=zy-commerce-demo.vercel.app");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(url: string, headers: Record<string, string> = {}) {
  return new NextRequest(url, { headers: { host: new URL(url).host, ...headers } });
}

const rewriteOf = (res: Response) => {
  const target = res.headers.get("x-middleware-rewrite");
  return target ? new URL(target) : null;
};
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe("proxy", () => {
  it("rewrites a store subdomain onto its tenant route, keeping path and query", () => {
    const res = proxy(request("http://acme.localhost:3000/products/atlas?ref=chat"));
    expect(rewriteOf(res)?.pathname).toBe("/acme/products/atlas");
    expect(rewriteOf(res)?.search).toBe("?ref=chat");
    expect(forwarded(res, TENANT_SLUG_HEADER)).toBe("acme");
  });

  it("maps a store's home page onto the tenant root", () => {
    expect(rewriteOf(proxy(request("http://acme.localhost:3000/")))?.pathname).toBe("/acme");
  });

  it("serves an aliased hostname as its store", () => {
    const res = proxy(request("https://zy-commerce-demo.vercel.app/admin/settings"));
    expect(rewriteOf(res)?.pathname).toBe("/demo/admin/settings");
    expect(forwarded(res, TENANT_SLUG_HEADER)).toBe("demo");
  });

  it("leaves the platform root alone", () => {
    const res = proxy(request("http://localhost:3000/platform/login"));
    expect(rewriteOf(res)).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("never forwards a tenant header the client made up", () => {
    const onRoot = proxy(request("http://localhost:3000/", { [TENANT_SLUG_HEADER]: "acme" }));
    expect(forwarded(onRoot, TENANT_SLUG_HEADER)).toBeNull();

    const onOtherStore = proxy(request("http://beta.localhost:3000/", { [TENANT_SLUG_HEADER]: "acme" }));
    expect(forwarded(onOtherStore, TENANT_SLUG_HEADER)).toBe("beta");
  });

  it("records the public host, so a Server Action's redirect resolves the same store", () => {
    expect(forwarded(proxy(request("http://acme.localhost:3000/admin")), "x-forwarded-host")).toBe("acme.localhost:3000");
  });

  it("keeps an x-forwarded-host the hosting platform already set", () => {
    const res = proxy(request("http://localhost:3000/", { "x-forwarded-host": "acme.localhost:3000" }));
    expect(forwarded(res, "x-forwarded-host")).toBe("acme.localhost:3000");
    expect(rewriteOf(res)?.pathname).toBe("/acme");
  });
});

describe("proxy matcher", () => {
  const matches = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path);

  it("runs on every page, including the generated link-preview image", () => {
    for (const path of ["/", "/products/atlas", "/admin/settings", "/opengraph-image"]) expect(matches(path), path).toBe(true);
  });

  it("skips API routes, Next internals and static files", () => {
    for (const path of ["/api/health", "/api/auth/session", "/_next/static/chunks/app.js", "/favicon.ico", "/robots.txt", "/sitemap.xml", "/images/logo.png", "/fonts/geist.woff2"]) {
      expect(matches(path), path).toBe(false);
    }
  });
});
