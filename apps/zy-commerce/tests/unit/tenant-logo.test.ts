import { describe, expect, it } from "vitest";
import { detectLogoType, formatBytes, isTenantLogoBlob, LOGO_ACCEPT, LOGO_ERRORS, LOGO_MAX_BYTES, logoPathname, validateLogo } from "@/lib/tenant/logo";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const png = () => new Uint8Array([...PNG_HEADER, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
const jpeg = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
// "RIFF", a little-endian length, "WEBP", then the first chunk tag.
const webp = () => new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const text = (s: string) => new TextEncoder().encode(s);

/** A buffer of `size` bytes that starts with a valid PNG header. */
function pngOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(PNG_HEADER);
  return bytes;
}

describe("detectLogoType", () => {
  it("recognises PNG, JPEG and WebP from their bytes", () => {
    expect(detectLogoType(png())).toBe("png");
    expect(detectLogoType(jpeg())).toBe("jpeg");
    expect(detectLogoType(webp())).toBe("webp");
  });

  it("does not recognise SVG, even though it is an image format", () => {
    // An SVG can carry script and a public store serves it to anyone.
    expect(detectLogoType(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectLogoType(text('<?xml version="1.0"?><svg/>'))).toBeNull();
  });

  it("rejects other formats and plain files", () => {
    expect(detectLogoType(text("GIF89a......"))).toBeNull();
    expect(detectLogoType(text("%PDF-1.7 ..."))).toBeNull();
    expect(detectLogoType(text("<html><body>not an image</body></html>"))).toBeNull();
    // RIFF is a container: a WAV file has the same first four bytes as WebP.
    expect(detectLogoType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });

  it("does not read past the end of a truncated file", () => {
    expect(detectLogoType(new Uint8Array())).toBeNull();
    expect(detectLogoType(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(detectLogoType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(detectLogoType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57]))).toBeNull();
  });
});

describe("validateLogo", () => {
  it("stores the type found in the bytes, whatever the file was called", () => {
    expect(validateLogo(png())).toEqual({ ok: true, type: "png", contentType: "image/png", extension: "png" });
    expect(validateLogo(jpeg())).toEqual({ ok: true, type: "jpeg", contentType: "image/jpeg", extension: "jpg" });
    expect(validateLogo(webp())).toEqual({ ok: true, type: "webp", contentType: "image/webp", extension: "webp" });
  });

  it("accepts a file of exactly 1 MB", () => {
    expect(validateLogo(pngOfSize(LOGO_MAX_BYTES))).toMatchObject({ ok: true, type: "png" });
  });

  it("rejects a file one byte over 1 MB, saying how big it is", () => {
    expect(validateLogo(pngOfSize(LOGO_MAX_BYTES + 1))).toEqual({ ok: false, error: LOGO_ERRORS.tooLarge(LOGO_MAX_BYTES + 1) });
    expect(LOGO_ERRORS.tooLarge(LOGO_MAX_BYTES + 1)).toBe("The logo must be 1 MB or smaller — this file is 1.0 MB.");
    expect(LOGO_ERRORS.tooLarge(3 * 1024 * 1024)).toBe("The logo must be 1 MB or smaller — this file is 3.0 MB.");
  });

  it("rejects an empty file", () => {
    expect(validateLogo(new Uint8Array())).toEqual({ ok: false, error: LOGO_ERRORS.missing });
  });

  it("rejects a disguised file: an SVG renamed to .png is still an SVG", () => {
    expect(validateLogo(text("<svg onload='alert(1)'/>"))).toEqual({ ok: false, error: LOGO_ERRORS.wrongType });
  });

  it("checks size before type, so an oversized non-image gets the size message", () => {
    const big = new Uint8Array(LOGO_MAX_BYTES + 10);
    expect(validateLogo(big)).toEqual({ ok: false, error: LOGO_ERRORS.tooLarge(LOGO_MAX_BYTES + 10) });
  });
});

describe("logoPathname", () => {
  it("keeps every store's logos under its own folder", () => {
    expect(logoPathname("cm_tenant_a", "png")).toBe("tenants/cm_tenant_a/logo.png");
    expect(logoPathname("cm_tenant_b", "jpg")).toBe("tenants/cm_tenant_b/logo.jpg");
  });
});

describe("isTenantLogoBlob", () => {
  const T = "cmtenantaaaa0001";
  const host = "https://abc123xyz.public.blob.vercel-storage.com";

  it("is true only for this tenant's file in a public Blob store", () => {
    expect(isTenantLogoBlob(`${host}/tenants/${T}/logo-Xy9aQ.png`, T)).toBe(true);
  });

  it("is false for another tenant's file", () => {
    expect(isTenantLogoBlob(`${host}/tenants/cmtenantbbbb0002/logo.png`, T)).toBe(false);
  });

  it("is false when this tenant's id is only a prefix of the folder name", () => {
    expect(isTenantLogoBlob(`${host}/tenants/${T}x/logo.png`, T)).toBe(false);
    expect(isTenantLogoBlob(`${host}/tenants/${T}`, T)).toBe(false);
  });

  it("is false for anything that is not our Blob store", () => {
    expect(isTenantLogoBlob(`https://cdn.shopify.com/tenants/${T}/logo.png`, T)).toBe(false);
    expect(isTenantLogoBlob(`https://static.nike.com/tenants/${T}/logo.png`, T)).toBe(false);
    expect(isTenantLogoBlob(`http://abc123xyz.public.blob.vercel-storage.com/tenants/${T}/logo.png`, T)).toBe(false);
    expect(isTenantLogoBlob(`https://abc.public.blob.vercel-storage.com.evil.example/tenants/${T}/logo.png`, T)).toBe(false);
    expect(isTenantLogoBlob(`https://evilpublic.blob.vercel-storage.com/tenants/${T}/logo.png`, T)).toBe(false);
  });

  it("is false for seeded paths, junk and empty values", () => {
    expect(isTenantLogoBlob("/images/logo.png", T)).toBe(false);
    expect(isTenantLogoBlob("not a url", T)).toBe(false);
    expect(isTenantLogoBlob("", T)).toBe(false);
    expect(isTenantLogoBlob(null, T)).toBe(false);
    expect(isTenantLogoBlob(undefined, T)).toBe(false);
    expect(isTenantLogoBlob(`${host}/tenants/${T}/logo.png`, "")).toBe(false);
  });
});

describe("upload form helpers", () => {
  it("offers exactly the three accepted types to the file picker", () => {
    expect(LOGO_ACCEPT).toBe("image/png,image/jpeg,image/webp");
  });

  it("formats sizes the way a store owner reads them", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(340 * 1024)).toBe("340 KB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });
});
