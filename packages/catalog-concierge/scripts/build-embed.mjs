/**
 * Bundles the `<script>` embed: React, the widget and its stylesheet in one
 * file a shop can point a script tag at.
 *
 * The stylesheet is inlined rather than fetched — the widget lives in a shadow
 * root, where a stylesheet has to be inside to apply at all, and one request
 * is one fewer thing to configure on someone else's CDN.
 *
 *   pnpm --filter catalog-concierge build:embed   (run after build:css)
 */
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";

const packageDir = resolve(import.meta.dirname, "..");
const stylesheet = resolve(packageDir, "dist/styles.css");
const outfile = resolve(packageDir, "dist/embed.js");

const css = readFileSync(stylesheet, "utf8");

await build({
  entryPoints: [resolve(packageDir, "src/embed.tsx")],
  outfile,
  bundle: true,
  format: "iife",
  platform: "browser",
  // What a shop's customers actually run. Nothing here needs anything newer.
  target: ["es2022", "chrome111", "firefox115", "safari16"],
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  define: {
    __CONCIERGE_CSS__: JSON.stringify(css),
    "process.env.NODE_ENV": '"production"',
  },
});

const bytes = statSync(outfile).size;
const gzipped = gzipSync(readFileSync(outfile)).length;
console.log(`✓ dist/embed.js — ${(bytes / 1024).toFixed(1)}KB, ${(gzipped / 1024).toFixed(1)}KB gzipped (React and the stylesheet included)`);
