/**
 * Fixed-window rate limiter (spec §5: rate-limit login and account creation).
 *
 * v1 uses an in-process Map, which is correct for a single Node instance and
 * for local development. On serverless (Vercel) each instance has its own map,
 * so limits are per-instance rather than global. Extension point: swap the
 * `RateLimitStore` for Upstash/Redis without touching call sites.
 */

export interface RateLimitPolicy {
  /** Max hits allowed within the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  /** Epoch ms when the window resets. */
  resetAt: number;
}

export interface RateLimitStore {
  hit(key: string, policy: RateLimitPolicy, now: number): RateLimitResult;
  reset(key?: string): void;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();
  private lastSweep = 0;

  hit(key: string, policy: RateLimitPolicy, now: number): RateLimitResult {
    this.sweep(now);
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + policy.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    const ok = bucket.count <= policy.limit;
    return { ok, remaining: Math.max(0, policy.limit - bucket.count), resetAt: bucket.resetAt };
  }

  reset(key?: string): void {
    if (key === undefined) this.buckets.clear();
    else this.buckets.delete(key);
  }

  /** Drop expired buckets at most once a minute so the map can't grow unbounded. */
  private sweep(now: number) {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
  }
}

// Survive Next.js dev hot-reloads by stashing the store on globalThis.
const g = globalThis as unknown as { __zyRateLimitStore?: RateLimitStore };
export const rateLimitStore: RateLimitStore = g.__zyRateLimitStore ?? (g.__zyRateLimitStore = new MemoryRateLimitStore());

export const RATE_LIMITS = {
  /** Per IP across all accounts. */
  loginPerIp: { limit: 30, windowMs: 15 * 60_000 },
  /** Per IP + email pair — the one that actually stops password guessing. */
  loginPerAccount: { limit: 5, windowMs: 15 * 60_000 },
  /** Account creation per IP. */
  registerPerIp: { limit: 10, windowMs: 60 * 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export function checkRateLimit(key: string, policy: RateLimitPolicy, now = Date.now()): RateLimitResult {
  return rateLimitStore.hit(key, policy, now);
}

/** Best-effort client IP from proxy headers; falls back to "unknown". */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? headers.get("cf-connecting-ip") ?? "unknown";
}
