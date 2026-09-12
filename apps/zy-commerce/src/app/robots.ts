import type { MetadataRoute } from "next";

/**
 * Nothing here should be in a search index.
 *
 * The demo storefronts carry real brand names, product names and images from
 * the shops whose public catalogues they were built from. Ranking in search
 * for those brands is the one thing that turns a clearly-labelled portfolio
 * demo into something a trademark owner has to act on. Traffic is meant to
 * arrive from a link that was deliberately shared, not from a query.
 *
 * The platform root is covered too: it is a demonstration, not a shop, and it
 * has nothing to gain from being crawled. Paired with `robots: { index: false }`
 * in the root layout, so the answer is the same whether a crawler reads this
 * file or only the page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
