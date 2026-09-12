import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, rateLimitStore } from "@/lib/auth/rate-limit";

beforeEach(() => {
  rateLimitStore.reset();
});

describe("checkRateLimit", () => {
  it("counts every caller of a key against one shared, process-wide store", () => {
    const policy = { limit: 2, windowMs: 60_000 };
    const t0 = 1_000_000;
    expect(checkRateLimit("shared:key", policy, t0).ok).toBe(true);
    expect(checkRateLimit("shared:key", policy, t0 + 1).ok).toBe(true);
    expect(checkRateLimit("shared:key", policy, t0 + 2)).toEqual({ ok: false, remaining: 0, resetAt: t0 + 60_000 });
    expect(checkRateLimit("shared:other", policy, t0 + 3).ok).toBe(true);
  });

  it("uses the current time when none is given", () => {
    const result = checkRateLimit("shared:now", { limit: 1, windowMs: 60_000 });
    expect(result.ok).toBe(true);
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });
});
