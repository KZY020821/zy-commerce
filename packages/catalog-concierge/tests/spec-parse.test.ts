import { describe, expect, it } from "vitest";
import { decodeEntities, htmlToLines, normalizeSpecKey, normalizeSpecs, parseLabelLines, parseTechSpecs, stripTags } from "../src/spec-parse";

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

describe("decodeEntities and stripTags", () => {
  it("decodes the entities product pages actually use", () => {
    expect(decodeEntities("Tom &amp; Jerry &quot;TM&quot; &#39;x&#39; &ndash; &trade; &reg; &#65;")).toBe(`Tom & Jerry "TM" 'x' – ™ ® A`);
  });

  it("strips tags and collapses whitespace", () => {
    expect(stripTags("<p> Core <strong>16mm</strong>\n thick </p>")).toBe("Core 16mm thick");
  });

  it("drops script and style content when splitting HTML into lines", () => {
    expect(htmlToLines("<p>One</p><script>alert(1)</script><style>p{}</style><ul><li>Two<br>Three</li></ul>")).toEqual(["One", "Two", "Three"]);
  });
});

describe("parseTechSpecs — notes and false headings", () => {
  it("records design notes, and skips a paragraph that reads like a label rather than a heading", () => {
    const html = `<div id="tech-specs"><p><strong>Max</strong></p><ul><li><strong>Weight:</strong> 8.0 oz</li><li>Designed and quality controlled in the USA</li><li>no label here</li></ul><p>Note: this is not a heading</p></div>`;
    expect(parseTechSpecs(html)).toEqual([{ heading: "Max", specs: { Weight: "8.0 oz", Design: "Designed and quality controlled in the USA" } }]);
  });
});

describe("normalizeSpecKey and normalizeSpecs", () => {
  it("title-cases words, keeps acronyms and units, and lowers small joining words", () => {
    expect(normalizeSpecKey("skill level")).toBe("Skill Level");
    expect(normalizeSpecKey("  weight   in oz ")).toBe("Weight in oz");
    expect(normalizeSpecKey("USAP approved")).toBe("USAP Approved");
    expect(normalizeSpecKey("core thickness mm")).toBe("Core Thickness mm");
    expect(normalizeSpecKey("price per pack")).toBe("Price per Pack");
    expect(normalizeSpecKey("for beginners")).toBe("For Beginners");
  });

  it("merges keys that normalise to the same name, keeping the first value", () => {
    expect(normalizeSpecs({ "skill level": "Beginner", "Skill Level": "Advanced", weight: "8 oz" })).toEqual({ "Skill Level": "Beginner", Weight: "8 oz" });
  });
});
