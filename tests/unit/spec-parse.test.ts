import { describe, expect, it } from "vitest";
import { htmlToLines, parseLabelLines, parseTechSpecs } from "@/lib/catalog/spec-parse";

const PAGE = `
<div class="desc"><p>Marketing copy with a colon: not a spec.</p></div>
<div id="tech-specs"><div class="metafield-rich_text_field">
<p><strong>HALO Power Technology</strong></p>
<p><strong>Max</strong></p>
<ul><li><strong>Skill Level: </strong>Beginner - Advanced</li><li><strong>Weight Range:</strong> 7.7 - 8.0 oz</li><li><strong>Core Thickness:</strong> 16mm</li><li>1-Year Limited Warranty</li></ul>
<p><strong>XL</strong></p>
<ul><li><strong>Skill Level: </strong>Beginner - Advanced</li><li><strong>Weight Range:</strong> 7.7 - 8.0 oz</li><li><strong>Core Thickness:</strong> 13mm</li></ul>
</div></div>
<div id="reviews"><ul><li><strong>Rating:</strong> 5</li></ul></div>`;

describe("parseTechSpecs", () => {
  it("splits per-heading sections and keeps label/value pairs", () => {
    const sections = parseTechSpecs(PAGE);
    expect(sections.map((s) => s.heading)).toEqual(["Max", "XL"]);
    expect(sections[0]!.specs).toMatchObject({ "Skill Level": "Beginner - Advanced", "Weight Range": "7.7 - 8.0 oz", "Core Thickness": "16mm", Warranty: "1-Year Limited Warranty" });
    expect(sections[1]!.specs["Core Thickness"]).toBe("13mm");
  });
  it("ignores content outside the spec container", () => {
    const all = parseTechSpecs(PAGE).flatMap((s) => Object.keys(s.specs));
    expect(all).not.toContain("Rating");
    expect(parseTechSpecs("<p>no specs here</p>")).toEqual([]);
  });
});

describe("parseLabelLines", () => {
  it("keeps short Label: value lines and drops sentences and noise", () => {
    const lines = htmlToLines("<p>Dimensions: 22” x 12.5” x 13”</p><p>Volume: 45L</p><p>To Clean: Spot clean only to protect premium fabrics.</p><p>Breathable Comfort: Keeps you cool and focused when the temperature and the competition rise all day long on court.</p>");
    expect(parseLabelLines(lines, /^breathable comfort$/i)).toEqual({ Dimensions: "22” x 12.5” x 13”", Volume: "45L" });
  });
  it("decodes entities and tolerates null html", () => {
    expect(htmlToLines(null)).toEqual([]);
    expect(htmlToLines("<li>Grip: 4.25&#8221; &amp; tacky</li>")).toEqual(['Grip: 4.25" & tacky']);
  });
});
