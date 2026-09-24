/**
 * Who may talk to the assistant endpoint. It spends money on every call, and
 * the widget is meant to be embedded on other people's sites, so "no" and
 * "yes, and here are your CORS headers" both have to be exactly right.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const allowed = vi.fn(() => "https://client.example, http://localhost:4173 , , not-a-url");
vi.mock("@/lib/env", () => ({ env: () => ({ ASSISTANT_ALLOWED_ORIGINS: allowed() }), isProduction: () => false }));

import { allowedEmbedOrigin, allowedOrigins, originVerdict } from "@/lib/ai/embed-origins";

beforeEach(() => {
  allowed.mockReturnValue("https://client.example, http://localhost:4173 , , not-a-url");
});

describe("allowedOrigins", () => {
  it("normalises what the store listed and drops what is not an origin", () => {
    expect(allowedOrigins()).toEqual(["https://client.example", "http://localhost:4173"]);
  });

  it("is empty when nothing is configured, which is the default", () => {
    allowed.mockReturnValue("");
    expect(allowedOrigins()).toEqual([]);
  });
});

describe("allowedEmbedOrigin", () => {
  it("matches a listed origin however the browser wrote it", () => {
    expect(allowedEmbedOrigin("https://client.example")).toBe("https://client.example");
    expect(allowedEmbedOrigin("https://client.example/")).toBe("https://client.example");
  });

  it("refuses everything else", () => {
    for (const origin of [null, "", "https://evil.example", "https://client.example.evil.com", "http://client.example", "null"]) {
      expect(allowedEmbedOrigin(origin), String(origin)).toBeNull();
    }
  });
});

describe("originVerdict", () => {
  it("treats the store's own pages as same-site", () => {
    expect(originVerdict("http://demo.localhost:3000", "demo.localhost:3000")).toEqual({ kind: "same-site" });
    // No Origin header: curl, a server-side call, an old browser.
    expect(originVerdict(null, "demo.localhost:3000")).toEqual({ kind: "same-site" });
  });

  it("recognises a listed embed, and hands back the origin to echo", () => {
    expect(originVerdict("https://client.example", "demo.localhost:3000")).toEqual({ kind: "embedded", origin: "https://client.example" });
  });

  it("refuses anybody else", () => {
    expect(originVerdict("https://evil.example", "demo.localhost:3000")).toEqual({ kind: "refused" });
    expect(originVerdict("not a url", "demo.localhost:3000")).toEqual({ kind: "refused" });
  });
});
