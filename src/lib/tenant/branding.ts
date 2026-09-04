/**
 * Storefront branding helpers (spec §7.2). The tenant's primaryColor is
 * injected as CSS custom properties that shadcn/ui components already read,
 * so each store looks distinct with zero code changes.
 */
import type { CSSProperties } from "react";
import type { Tenant } from "@/generated/prisma/client";

export const HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_COLOR_PATTERN.test(value);
}

function expandHex(hex: string): [number, number, number] {
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** WCAG relative luminance, 0 (black) .. 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = expandHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** White or near-black text, whichever contrasts better with the background. */
export function contrastingTextColor(hex: string): "#ffffff" | "#111111" {
  return relativeLuminance(hex) > 0.4 ? "#111111" : "#ffffff";
}

type BrandingSource = Pick<Tenant, "primaryColor">;

/** Inline style object applied to the tenant wrapper element. */
export function tenantCssVars(tenant: BrandingSource): CSSProperties {
  const primary = isHexColor(tenant.primaryColor) ? tenant.primaryColor : "#0f172a";
  return {
    "--primary": primary,
    "--primary-foreground": contrastingTextColor(primary),
    "--ring": primary,
    "--sidebar-primary": primary,
    "--sidebar-primary-foreground": contrastingTextColor(primary),
  } as CSSProperties;
}
