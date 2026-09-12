/**
 * Adds explicit `.js` extensions to relative specifiers in `dist`.
 *
 * The source is written in bundler style (`from "./guard"`), which is what
 * every bundler and the workspace consumer expect. Node's ESM resolver does
 * not guess extensions, so the published build has to spell them out or an
 * `import "catalog-concierge"` from plain Node throws ERR_MODULE_NOT_FOUND.
 * Doing it here keeps the rewrite out of the source and out of the dev loop.
 *
 * `.d.ts` files get the same treatment so TypeScript consumers on
 * `moduleResolution: node16/nodenext` resolve the types too.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const DIST = resolve(import.meta.dirname, "..", "dist");
const SPECIFIER = /(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.\.?\/[^"']*)\2/g;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** `./guard` → `./guard.js`, `./ui` → `./ui/index.js`; already-explicit paths are left alone. */
function withExtension(fromFile, specifier) {
  if (/\.(js|json|mjs|cjs)$/.test(specifier)) return specifier;
  const base = resolve(dirname(fromFile), specifier);
  const exists = (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };
  if (exists(`${base}.js`)) return `${specifier}.js`;
  if (exists(join(base, "index.js"))) return `${specifier}/index.js`;
  return specifier;
}

let changed = 0;
for (const file of walk(DIST)) {
  if (!/\.(js|d\.ts)$/.test(file)) continue;
  const source = readFileSync(file, "utf8");
  const next = source.replace(SPECIFIER, (whole, lead, quote, spec) => {
    const fixed = withExtension(file, spec);
    return fixed === spec ? whole : `${lead}${quote}${fixed}${quote}`;
  });
  if (next !== source) {
    writeFileSync(file, next);
    changed++;
  }
}
console.log(`✓ ESM extensions written into ${changed} file(s) under dist/`);
