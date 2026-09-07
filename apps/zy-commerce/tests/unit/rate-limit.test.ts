import { describe, expect, it } from "vitest";
import { clientIpFromHeaders, MemoryRateLimitStore } from "@/lib/auth/rate-limit";

describe("MemoryRateLimitStore", () => {
  const policy = { limit: 3, windowMs: 1000 };

  it("allows up to the limit then blocks within the window", () => {
    const store = new MemoryRateLimitStore();
    const t0 = 1_000_000;
    expect(store.hit("k", policy, t0).ok).toBe(true);
    expect(store.hit("k", policy, t0 + 10).ok).toBe(true);
    expect(store.hit("k", policy, t0 + 20).ok).toBe(true);
    const blocked = store.hit("k", policy, t0 + 30);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetAt).toBe(t0 + policy.windowMs);
  });

  it("resets after the window elapses", () => {
    const store = new MemoryRateLimitStore();
    const t0 = 5_000;
    for (let i = 0; i < 4; i++) store.hit("k", policy, t0);
    expect(store.hit("k", policy, t0 + 999).ok).toBe(false);
    expect(store.hit("k", policy, t0 + 1000).ok).toBe(true);
  });

  it("keys are independent", () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 5; i++) store.hit("a", policy, 0);
    expect(store.hit("b", policy, 0).ok).toBe(true);
  });

  it("reset clears one key or all", () => {
    const store = new MemoryRateLimitStore();
    for (let i = 0; i < 5; i++) store.hit("a", policy, 0);
    store.reset("a");
    expect(store.hit("a", policy, 1).ok).toBe(true);
    for (let i = 0; i < 5; i++) store.hit("a", policy, 1);
    store.reset();
    expect(store.hit("a", policy, 2).ok).toBe(true);
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers the first x-forwarded-for entry", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip then unknown", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
