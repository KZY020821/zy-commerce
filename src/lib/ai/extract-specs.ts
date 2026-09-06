/**
 * Turns a free-text product description into structured specs so that
 * products added later through the admin (Phase 1) are understood by the
 * assistant without any manual data entry. Returns null when no model
 * credentials are configured.
 *
 * DeepSeek's OpenAI-compatible JSON mode (response_format: json_object) has
 * no schema-enforcement option, so the shape is described in the prompt and
 * validated with Zod after parsing — see
 * https://api-docs.deepseek.com/guides/json_mode.
 */
import { z } from "zod";
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

const SYSTEM_PROMPT = [
  "Extract factual, structured product specifications from the text and return them as JSON.",
  "Only include attributes that are explicitly stated (materials, dimensions, weight, sizes, capacity, compatibility, skill level, certifications, care, warranty). Never guess. Reuse the provided known keys when the meaning matches so the catalogue stays consistent. Keep values short.",
  "",
  'Respond with a single JSON object of exactly this shape: {"specs": [{"key": "Core Thickness", "value": "16mm"}, ...]}. No prose, no markdown — JSON only.',
].join("\n");

export async function extractSpecs(input: ExtractSpecsInput): Promise<Record<string, string> | null> {
  const ai = getAiClient();
  if (!ai) return null;

  const response = await ai.client.chat.completions.create({
    model: ai.model,
    max_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
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

  const raw = response.choices[0]?.message.content;
  if (!raw) return null;
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = SpecsSchema.safeParse(json);
  if (!parsed.success) return null;
  return Object.fromEntries(parsed.data.specs.map((s) => [s.key.trim(), s.value.trim()]));
}
