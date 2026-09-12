import { ImageResponse } from "next/og";

/**
 * The link preview image, shared by the platform root and by every tenant
 * storefront.
 *
 * It lives here rather than in one `opengraph-image.tsx` because Next's file
 * convention attaches an image to the segment it sits in, and a nested
 * `generateMetadata` that returns its own `openGraph` object replaces the
 * parent's wholesale — so the storefronts, which are the links that actually
 * get shared, would lose the picture. Each segment declares the convention and
 * calls this.
 *
 * Deliberately typographic: no product photography, because those images
 * belong to the shops the demo catalogues came from and a link preview is
 * exactly the context where their provenance would be lost.
 */
export const alt = "Catalog Concierge — AI chat that answers from your product catalogue";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function renderLinkPreview() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0B0B0B",
          color: "#F5F5F5",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 26, color: "#A1A1A1" }}>
          <div style={{ display: "flex", width: 14, height: 14, borderRadius: 7, background: "#22C55E" }} />
          Catalog Concierge
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 82, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>Ask the store anything.</div>
          <div style={{ fontSize: 34, color: "#A1A1A1", lineHeight: 1.35, maxWidth: 900 }}>
            A chat assistant that answers from your own catalogue — real prices,
            real stock, and the right question back.
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#6B6B6B" }}>
          <div style={{ display: "flex" }}>Live demo · two real catalogues</div>
          <div style={{ display: "flex" }}>Built by Khor Ze Yi</div>
        </div>
      </div>
    ),
    size,
  );
}
