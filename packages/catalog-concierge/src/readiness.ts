/**
 * How well a catalogue can be talked about.
 *
 * The assistant is only as good as the structured data behind it: a product
 * with no specifications can be found and priced, but not compared, and not
 * recommended for a reason. That is invisible in a product list, so it is
 * measured here — for a shop owner's dashboard, and for the first minute of
 * an evaluation, where it explains most of what follows.
 */
import { specsToRecord } from "./format";
import type { CatalogueProduct } from "./types";

export interface CatalogueReadiness {
  products: number;
  withSpecs: number;
  withDescription: number;
  withImage: number;
  /** Share of products the assistant can compare on detail, 0–100. */
  specCoverage: number;
  /** Mean number of specifications across the whole catalogue, one decimal. */
  averageSpecs: number;
  /** Products with the fewest specifications, worst first. */
  thinnest: { ref: string; name: string; specCount: number }[];
}

const THINNEST = 5;

/** Specifications that actually say something: a blank value is not one. */
export function countSpecs(specs: CatalogueProduct["specs"]): number {
  return Object.keys(specsToRecord(specs)).length;
}

export function assessCatalogue(catalogue: CatalogueProduct[]): CatalogueReadiness {
  const counted = catalogue.map((product) => ({ ref: product.ref, name: product.name, specCount: countSpecs(product.specs) }));
  const withSpecs = counted.filter((p) => p.specCount > 0).length;
  const totalSpecs = counted.reduce((sum, p) => sum + p.specCount, 0);

  return {
    products: catalogue.length,
    withSpecs,
    withDescription: catalogue.filter((p) => (p.description ?? "").trim()).length,
    withImage: catalogue.filter((p) => (p.imageUrl ?? "").trim()).length,
    specCoverage: catalogue.length === 0 ? 0 : Math.round((withSpecs / catalogue.length) * 100),
    averageSpecs: catalogue.length === 0 ? 0 : Math.round((totalSpecs / catalogue.length) * 10) / 10,
    thinnest: [...counted].sort((a, b) => a.specCount - b.specCount || a.name.localeCompare(b.name)).slice(0, THINNEST),
  };
}
