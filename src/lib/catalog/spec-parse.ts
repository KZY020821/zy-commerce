/**
 * Extracts structured specifications from product HTML/text. Used by the
 * catalogue importer today and by the admin product form later (paste a
 * spec sheet → structured specs). Pure functions, no I/O.
 */

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;|&#8217;/g, "'").replace(/&ldquo;|&rdquo;|&#8220;|&#8221;/g, '"')
    .replace(/&nbsp;/g, " ").replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—").replace(/&trade;/g, "™").replace(/&reg;/g, "®")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

export function htmlToLines(html: string | null | undefined): string[] {
  if (!html) return [];
  return decodeEntities(
    html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div|h\d|tr|td|dt|dd|section)>/gi, "\n").replace(/<[^>]+>/g, ""),
  ).split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export interface SpecSection {
  /** e.g. a paddle shape ("Max", "XL") when a product lists specs per option; null for the general block. */
  heading: string | null;
  specs: Record<string, string>;
}

/**
 * Parses a Shopify "tech specs" block of the shape
 *   <div id="tech-specs"> <p><strong>Heading</strong></p> <ul><li><strong>Label:</strong> value</li>…
 * Headings without a colon start a new section (used for per-variant specs).
 */
export function parseTechSpecs(pageHtml: string, containerId = "tech-specs"): SpecSection[] {
  const start = pageHtml.indexOf(`id="${containerId}"`);
  if (start === -1) return [];
  let block = pageHtml.slice(start, start + 30_000);
  const end = block.search(new RegExp(`<div[^>]+id="(?!${containerId})[a-z-]+"`, "i"));
  if (end > 0) block = block.slice(0, end);

  const sections: SpecSection[] = [];
  let current: SpecSection = { heading: null, specs: {} };
  const tokens = block.match(/<p[^>]*>[\s\S]*?<\/p>|<li[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  for (const tok of tokens) {
    const text = stripTags(tok);
    if (/^<p/i.test(tok)) {
      if (!text || text.length > 40 || text.includes(":")) continue;
      if (Object.keys(current.specs).length) sections.push(current);
      current = { heading: text, specs: {} };
      continue;
    }
    const m = text.match(/^([^:]{2,40}):\s*(.+)$/);
    if (m) current.specs[m[1]!.trim()] = m[2]!.trim();
    else if (/warranty/i.test(text)) current.specs["Warranty"] = text;
    else if (/designed and quality controlled/i.test(text)) current.specs["Design"] = text;
  }
  if (Object.keys(current.specs).length) sections.push(current);
  return sections;
}

const LABEL_LINE = /^([A-Z][A-Za-z0-9 /()&'’.-]{1,40}?):\s+(.{1,120})$/;
const NOISE_LABELS = /^(to clean|note|warning|disclaimer|shipping|returns?|pro tip|tip|bonus|new|sale|step \d+)$/i;

/**
 * Fallback for products without a spec block: short "Label: value" lines in
 * the description. Sentences (> 14 words) and marketing feature bullets are
 * skipped.
 */
export function parseLabelLines(lines: string[], marketingLabels: RegExp = /^$/): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const line of lines) {
    const m = line.match(LABEL_LINE);
    if (!m) continue;
    const label = m[1]!.trim();
    if (NOISE_LABELS.test(label) || marketingLabels.test(label)) continue;
    if (m[2]!.split(" ").length > 14) continue;
    specs[label] ??= m[2]!.trim();
  }
  return specs;
}

const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "by", "for", "in", "of", "on", "or", "per", "the", "to", "vs", "with"]);

/** "Skill level" / "skill  LEVEL" → "Skill Level"; all-caps tokens (USAP) and units (mm, oz) are kept. */
export function normalizeSpecKey(key: string): string {
  return key
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w, i) => {
      if (/^[A-Z0-9]{2,}$/.test(w)) return w;
      if (/^(mm|oz|cm|kg|g|lb|lbs|in)$/i.test(w)) return w.toLowerCase();
      const lower = w.toLowerCase();
      if (i > 0 && SMALL_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

export function normalizeSpecs(specs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs)) out[normalizeSpecKey(k)] ??= v;
  return out;
}
