/**
 * The way out of the chat, to a person.
 *
 * An assistant that cannot answer is where a shop loses the sale, so the
 * widget offers whatever contact the store has configured. WhatsApp first:
 * these stores sell in Malaysia and Singapore, where it is how people talk to
 * a shop.
 */

/** E.164 without punctuation, which is what a wa.me link needs. */
export function whatsappDigits(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

/** A plain address, so nothing else can be smuggled into a mailto: link. */
const EMAIL = /^[^\s@,;:<>()[\]\\"?&=]+@[^\s@,;:<>()[\]\\"?&=]+\.[a-z]{2,}$/i;

export interface SupportHandoff {
  label: string;
  href: string;
}

export function supportHandoff(tenant: { supportWhatsapp?: string | null; contactEmail?: string | null }): SupportHandoff | undefined {
  const digits = whatsappDigits(tenant.supportWhatsapp);
  if (digits) return { label: "Message the shop on WhatsApp", href: `https://wa.me/${digits}` };

  const email = tenant.contactEmail?.trim() ?? "";
  if (EMAIL.test(email)) return { label: "Email the shop", href: `mailto:${email}` };

  return undefined;
}
