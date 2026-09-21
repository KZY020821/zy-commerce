/**
 * `catalog-concierge evaluate` — the assistant, on your own catalogue.
 *
 * Export your products to JSON, run this, read what comes back. It is the
 * honest answer to "will it work for my shop?", and it needs nothing from the
 * shop's own codebase.
 *
 *   npx catalog-concierge evaluate products.json
 *   npx catalog-concierge evaluate products.json --questions questions.txt --store "Acme" --currency MYR
 *   npx catalog-concierge evaluate products.json --dry     # no model, no spend
 */
import { readFile } from "node:fs/promises";
import { getModelClient } from "./model";
import { evaluateCatalogue, type Evaluation, type EvaluationOptions } from "./evaluate";
import { assessCatalogue } from "./readiness";
import type { CatalogueProduct, StoreProfile } from "./types";

const USAGE = `catalog-concierge evaluate <catalogue.json> [options]

  <catalogue.json>      An array of products: ref, name, price (minor units),
                        and — the part that matters — specs.

  --questions <file>    One question per line. Defaults to the store's own
                        opening chips.
  --store <name>        Store name for the assistant's prompt.
  --assistant <name>    What the assistant calls itself.
  --currency <code>     ISO 4217, e.g. MYR. Default USD.
  --locale <tag>        BCP 47, e.g. en-MY. Default en-US.
  --synonyms <words>    Comma separated words your customers use that your
                        catalogue does not ("shoes" for a Footwear category).
  --rates <in,out,cached>  Price per million tokens, to cost the run.
  --dry                 Report the catalogue and stop, without calling a model.
  --json                Print the whole evaluation as JSON.

  A model key is read from the environment (DEEPSEEK_API_KEY, or any
  OpenAI-compatible endpoint via AI_BASE_URL and AI_MODEL).`;

interface Flags {
  catalogue?: string;
  questions?: string;
  store: string;
  assistant: string;
  currency: string;
  locale: string;
  rates?: { inputPerMillion: number; outputPerMillion: number; cachedInputPerMillion?: number };
  synonyms: string[];
  dry: boolean;
  json: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Flags {
  const flags: Flags = { store: "This store", assistant: "Product Assistant", currency: "USD", locale: "en-US", synonyms: [], dry: false, json: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const value = () => argv[++i] ?? "";
    if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--dry") flags.dry = true;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--questions") flags.questions = value();
    else if (arg === "--store") flags.store = value();
    else if (arg === "--assistant") flags.assistant = value();
    else if (arg === "--currency") flags.currency = value().toUpperCase();
    else if (arg === "--locale") flags.locale = value();
    else if (arg === "--rates") flags.rates = parseRates(value());
    else if (arg === "--synonyms") flags.synonyms = value().split(",").map((word) => word.trim()).filter(Boolean);
    else if (arg === "evaluate") continue;
    else if (!arg.startsWith("-") && !flags.catalogue) flags.catalogue = arg;
  }
  return flags;
}

function parseRates(raw: string): Flags["rates"] {
  const [input, output, cached] = raw.split(",").map((part) => Number(part.trim()));
  if (!Number.isFinite(input) || !Number.isFinite(output)) return undefined;
  return { inputPerMillion: input!, outputPerMillion: output!, ...(Number.isFinite(cached) ? { cachedInputPerMillion: cached! } : {}) };
}

/** A catalogue file, checked far enough to give a useful error. */
export function parseCatalogue(raw: string): CatalogueProduct[] {
  const parsed: unknown = JSON.parse(raw);
  const products = Array.isArray(parsed) ? parsed : (parsed as { products?: unknown })?.products;
  if (!Array.isArray(products)) throw new Error("Expected a JSON array of products, or an object with a `products` array.");

  return products.map((entry, index) => {
    const product = entry as Partial<CatalogueProduct>;
    if (typeof product.ref !== "string" || !product.ref.trim()) throw new Error(`Product ${index + 1} has no "ref" (a SKU, or anything unique).`);
    if (typeof product.name !== "string" || !product.name.trim()) throw new Error(`Product ${index + 1} (${product.ref}) has no "name".`);
    if (typeof product.price !== "number") throw new Error(`Product ${index + 1} (${product.ref}) has no numeric "price" in minor units (e.g. 35290 for RM 352.90).`);
    return product as CatalogueProduct;
  });
}

const pad = (value: string | number, width: number) => String(value).padEnd(width);

/** The model the environment offers, in the shape `evaluateCatalogue` takes. */
function resolveModel(): EvaluationOptions["model"] {
  const resolved = getModelClient();
  return resolved ? { client: resolved.client as NonNullable<EvaluationOptions["model"]>["client"], modelId: resolved.model } : undefined;
}

function printReadiness(evaluation: Pick<Evaluation, "readiness">, log: (line: string) => void): void {
  const { readiness } = evaluation;
  log(`Catalogue: ${readiness.products} products`);
  log(`  with specifications : ${readiness.withSpecs} (${readiness.specCoverage}%), ${readiness.averageSpecs} on average`);
  log(`  with a description  : ${readiness.withDescription}`);
  log(`  with a photo        : ${readiness.withImage}`);
  if (readiness.thinnest.some((p) => p.specCount === 0)) {
    log("  least to say about  :");
    for (const product of readiness.thinnest) log(`    ${pad(product.name.slice(0, 48), 50)} ${product.specCount === 0 ? "no specifications" : `${product.specCount} specifications`}`);
  }
}

export interface CommandDependencies {
  /**
   * The model to evaluate with. Resolved from the environment when omitted,
   * which is what the command line does; supplied directly by tests and by a
   * host that drives the command itself.
   */
  model?: EvaluationOptions["model"];
}

/** Runs the command. Returns the process exit code. */
export async function run(argv: string[], log: (line: string) => void = console.log, deps: CommandDependencies = {}): Promise<number> {
  const flags = parseArgs(argv);
  if (flags.help || !flags.catalogue) {
    log(USAGE);
    return flags.help ? 0 : 1;
  }

  let catalogue: CatalogueProduct[];
  try {
    catalogue = parseCatalogue(await readFile(flags.catalogue, "utf8"));
  } catch (err) {
    log(`Could not read ${flags.catalogue}: ${(err as Error).message}`);
    return 1;
  }

  const store: StoreProfile = { storeName: flags.store, assistantName: flags.assistant, currency: flags.currency, locale: flags.locale, ...(flags.synonyms.length ? { synonyms: flags.synonyms } : {}) };

  if (flags.dry) {
    if (flags.json) log(JSON.stringify({ readiness: assessCatalogue(catalogue) }, null, 2));
    else printReadiness({ readiness: assessCatalogue(catalogue) }, log);
    return 0;
  }

  const model = deps.model ?? resolveModel();
  if (!model) {
    log("No model credentials found. Set DEEPSEEK_API_KEY (or AI_BASE_URL and AI_MODEL), or run with --dry.");
    return 1;
  }

  const questions = flags.questions ? (await readFile(flags.questions, "utf8")).split("\n").map((line) => line.trim()).filter(Boolean) : undefined;
  const evaluation = await evaluateCatalogue({ catalogue, store, questions, model, ...(flags.rates ? { rates: flags.rates } : {}) });

  if (flags.json) {
    log(JSON.stringify(evaluation, null, 2));
    return 0;
  }

  printReadiness(evaluation, log);
  log("");
  for (const result of evaluation.results) {
    log(`? ${result.question}`);
    if (result.refused) {
      log("  REFUSED by the off-topic guard — no model call. If your customers ask this, the word they used is not one your catalogue uses: add it with --synonyms (or `store.synonyms`), or answer it from the shop information field.");
    } else {
      log(`  ${result.answer.replace(/\n+/g, " ").slice(0, 160)}${result.answer.length > 160 ? "…" : ""}`);
      log(`  products: ${result.products.length ? result.products.join(", ") : "none"} · tools: ${result.tools.length ? result.tools.join(", ") : "none"} · ${result.usage.inputTokens + result.usage.outputTokens} tokens · ${result.ms}ms${result.cost !== undefined ? ` · ${result.cost.toFixed(4)}` : ""}`);
    }
    log("");
  }

  const { summary } = evaluation;
  log(`${summary.answered} of ${summary.asked} answered, ${summary.refused} refused, ${summary.withoutProducts} answered without naming a product.`);
  log(`${summary.usage.inputTokens + summary.usage.outputTokens} tokens (${summary.usage.cachedInputTokens} from cache), median ${summary.medianMs}ms per question${summary.cost !== undefined ? `, ${summary.cost.toFixed(4)} total` : ""}.`);
  return 0;
}
