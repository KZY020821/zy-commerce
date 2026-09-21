/**
 * Proves the package works the way a client would install it.
 *
 * Builds it, packs the exact tarball npm would publish, installs that tarball
 * into an empty project alongside its peer dependencies, and imports both
 * entry points under plain Node ESM — no workspace, no bundler, no TypeScript.
 * Anything that only works because of this monorepo's layout fails here.
 *
 *   pnpm --filter catalog-concierge test:pack
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const packageDir = resolve(import.meta.dirname, "..");
const work = mkdtempSync(join(tmpdir(), "concierge-pack-"));
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: "inherit" });

const check = `
import { existsSync, readFileSync } from "node:fs";
import * as core from "catalog-concierge";
import * as ui from "catalog-concierge/react";

const fail = (message) => { console.error("✗ " + message); process.exit(1); };
for (const name of ["askConcierge", "classifyMessage", "buildStoreVocabulary", "buildCatalogProfile", "searchCatalogue", "trimHistory", "isQuestion", "formatMoney", "getModelClient"]) {
  if (typeof core[name] !== "function") fail("missing export " + name);
}
if (typeof core.OFF_TOPIC_REPLY !== "string") fail("missing OFF_TOPIC_REPLY");
if (typeof ui.ConciergeWidget !== "function") fail("missing ConciergeWidget from catalog-concierge/react");

// Behaviour, not just shape: the guard refuses the weather without any model.
const profile = core.buildCatalogProfile([{ ref: "P1", name: "Trail Runner", price: 12000, category: { slug: "shoes", name: "Shoes" }, specs: {} }]);
const vocab = core.buildStoreVocabulary({ storeName: "Acme", profile, productNames: ["Trail Runner"] });
if (core.classifyMessage("what is the weather?", vocab, { hasHistory: false }).onTopic) fail("the guard admitted an off-topic question");
if (!core.classifyMessage("do you have trail runners?", vocab, { hasHistory: false }).onTopic) fail("the guard refused a catalogue question");

for (const file of ["index.d.ts", "react.d.ts", "index.js", "react.js", "styles.css"]) {
  if (!existsSync(new URL("./node_modules/catalog-concierge/dist/" + file, import.meta.url))) fail("the tarball has no dist/" + file);
}

// The stylesheet is what a host without Tailwind installs. It has to carry the
// widget's own classes, and it must not carry a reset that would reformat the
// shop around it.
const css = readFileSync(new URL("./node_modules/catalog-concierge/dist/styles.css", import.meta.url), "utf8");
for (const needed of ["max-height:9.75rem", "line-clamp-2", "animate-bounce", "var(--primary,", "prefers-color-scheme:dark", "env(safe-area-inset-bottom)"]) {
  if (!css.includes(needed)) fail("the stylesheet is missing " + needed);
}
for (const forbidden of ["body{margin:0", "h1,h2,h3", "button,[type"]) {
  if (css.includes(forbidden)) fail("the stylesheet resets the host page: " + forbidden);
}

// The <script> embed: one file a shop points a tag at, React and the
// stylesheet inside it. A budget, because this one is downloaded by every
// visitor of every shop that installs it.
const embed = readFileSync(new URL("./node_modules/catalog-concierge/dist/embed.js", import.meta.url), "utf8");
const embedKb = Math.round(embed.length / 1024);
if (embedKb > 320) fail("the embed bundle has grown to " + embedKb + "KB");
for (const needed of ["data-concierge-root", "attachShadow", "@property"]) {
  if (!embed.includes(needed)) fail("the embed bundle is missing " + needed);
}
for (const file of ["LICENSE", "README.md"]) {
  if (!existsSync(new URL("./node_modules/catalog-concierge/" + file, import.meta.url))) fail("the tarball has no " + file);
}
console.log("✓ installed from the tarball: " + Object.keys(core).length + " exports, widget entry, types, a " + Math.round(css.length / 1024) + "KB stylesheet with no page reset, a " + embedKb + "KB script embed, LICENSE and README present");
`;

try {
  // `prepack` builds dist/ first, so this also proves the build.
  run("pnpm", ["pack", "--pack-destination", work], packageDir);
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error("pnpm pack produced no tarball");

  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "consumer", private: true, type: "module" }));
  run("npm", ["install", "--no-audit", "--no-fund", "--loglevel=error", join(work, tarball), "openai@^7", "zod@^4", "react@^19"], consumer);
  if (!existsSync(join(consumer, "node_modules", "catalog-concierge"))) throw new Error("the tarball did not install");

  writeFileSync(join(consumer, "check.mjs"), check);
  run("node", ["check.mjs"], consumer);
} finally {
  rmSync(work, { recursive: true, force: true });
}
