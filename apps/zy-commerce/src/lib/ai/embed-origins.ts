/**
 * Who may talk to this store's assistant endpoint.
 *
 * Three answers, and the difference matters: the storefront itself, a site the
 * store has listed so it can embed the widget, and everyone else. An embedded
 * site needs cross-origin headers and a cookie the browser will keep across
 * sites; everyone else gets nothing at all, because the endpoint spends money.
 */
import { env } from "@/lib/env";

export type OriginVerdict =
  | { kind: "same-site" }
  | { kind: "embedded"; origin: string }
  | { kind: "refused" };

/** The origins in ASSISTANT_ALLOWED_ORIGINS, normalised and without blanks. */
export function allowedOrigins(): string[] {
  return (env().ASSISTANT_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => normalise(value))
    .filter((value): value is string => Boolean(value));
}

/** An origin string reduced to scheme + host + port, or null if it is not one. */
function normalise(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/** The listed origin matching this request, for the CORS headers. */
export function allowedEmbedOrigin(origin: string | null): string | null {
  const candidate = origin ? normalise(origin) : null;
  return candidate && allowedOrigins().includes(candidate) ? candidate : null;
}

export function originVerdict(origin: string | null, requestHost: string | null): OriginVerdict {
  // No Origin header at all: curl, a server-side call, an old browser on a
  // same-site form post. Same-site is the safe reading, and the session cookie
  // stays `lax`.
  if (!origin) return { kind: "same-site" };

  const candidate = normalise(origin);
  if (candidate && requestHost && new URL(candidate).host === requestHost) return { kind: "same-site" };

  const embedded = allowedEmbedOrigin(origin);
  return embedded ? { kind: "embedded", origin: embedded } : { kind: "refused" };
}
