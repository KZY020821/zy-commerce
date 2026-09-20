/**
 * The way out of the chat, to a person. Both links leave our site, so what
 * goes into them is checked rather than trusted.
 */
import { describe, expect, it } from "vitest";
import { supportHandoff, whatsappDigits } from "@/lib/tenant/handoff";

describe("whatsappDigits", () => {
  it("keeps the digits of an international number, however it was typed", () => {
    expect(whatsappDigits("+60 12-345 6789")).toBe("60123456789");
    expect(whatsappDigits("(65) 8123 4567")).toBe("6581234567");
  });

  it("refuses anything that is not a phone number", () => {
    for (const value of ["", "   ", "call me", "12345", "1".repeat(16), null, undefined]) {
      expect(whatsappDigits(value), String(value)).toBeNull();
    }
  });
});

describe("supportHandoff", () => {
  it("prefers WhatsApp, which is how these markets talk to a shop", () => {
    expect(supportHandoff({ supportWhatsapp: "+60 12-345 6789", contactEmail: "hello@shop.test" })).toEqual({
      label: "Message the shop on WhatsApp",
      href: "https://wa.me/60123456789",
    });
  });

  it("falls back to the store's contact email", () => {
    expect(supportHandoff({ supportWhatsapp: null, contactEmail: "hello@shop.test" })).toEqual({
      label: "Email the shop",
      href: "mailto:hello@shop.test",
    });
  });

  it("offers nothing when the store has given no contact, and nothing that is not an address", () => {
    expect(supportHandoff({ supportWhatsapp: null, contactEmail: null })).toBeUndefined();
    // A crafted value must not become extra mailto: fields.
    expect(supportHandoff({ contactEmail: "hello@shop.test?subject=hi&bcc=someone@else.test" })).toBeUndefined();
    expect(supportHandoff({ contactEmail: "not an address" })).toBeUndefined();
  });
});
