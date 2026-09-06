/**
 * Turns a free-text product description into structured specs so that
 * products added later through the admin (Phase 1) are understood by the
 * assistant without any manual data entry. Uses structured outputs so the
 * result is always a flat key/value object. Returns null when no model
 * credentials are configured.
 */
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { getAiClient } from "./client";

const SpecsSchema = z.object({
  specs: z.array(z.object({ key: z.string().min(1).max(40), value: z.string().min(1).max(120) })).max(30),
});

export interface ExtractSpecsInput {
  name: string;
  brand?: string | null;
  category?: string | null;
  description: string;
  /** Keys already used by sibling products — encourages consistent naming (e.g. "Core Thickness"). */
  knownKeys?: string[];
}

export async function extractSpecs(input: ExtractSpecsInput): Promise<Record<string, string> | null> {
  const ai = getAiClient();
  if (!ai) return null;
  const response = await ai.client.messages.parse({
    model: ai.model,
    max_tokens: 2048,
    output_config: { effort: "low", format: zodOutputFormat(SpecsSchema) },
    system:
      "Extract factual, structured product specifications from the text. Only include attributes that are explicitly stated (materials, dimensions, weight, sizes, capacity, compatibility, skill level, certifications, care, warranty). Never guess. Reuse the provided known keys when the meaning matches so the catalogue stays consistent. Keep values short.",
    messages: [
      {
        role: "user",
        content: [
          `Product: ${input.name}`,
          input.brand ? `Brand: ${input.brand}` : "",
          input.category ? `Category: ${input.category}` : "",
          input.knownKeys?.length ? `Known spec keys in this store: ${input.knownKeys.join(", ")}` : "",
          "",
          "Description:",
          input.description,
        ].filter(Boolean).join("\n"),
      },
    ],
  });
  const parsed = response.parsed_output;
  if (!parsed) return null;
  return Object.fromEntries(parsed.specs.map((s) => [s.key.trim(), s.value.trim()]));
}
