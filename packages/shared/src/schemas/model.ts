import { z } from "zod";

export const modelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  isDefault: z.boolean().optional(),
  description: z.string().optional(),
});

export const modelListResponseSchema = z.object({
  models: z.array(modelSchema),
});

export type Model = z.infer<typeof modelSchema>;
export type ModelListResponse = z.infer<typeof modelListResponseSchema>;

const PREFERRED_MODEL_ALIASES: string[][] = [
  [
    "gemini 3.1 pro preview",
    "gemini 3 1 pro preview",
    "gemini 3.1 pro",
    "gemini 3 1 pro",
    "gemini 3-1 pro",
  ],
  ["gemini 3 pro", "gemini 3.0 pro", "gemini 3 0 pro"],
  ["gemini 2.5 pro", "gemini 2 5 pro"],
  ["claude sonnet 4"],
  ["gpt 5"],
];

function normalizeModelToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/^[a-z0-9]+\//, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getModelSearchTokens(
  model: string | { id: string; name: string },
): string[] {
  if (typeof model === "string") {
    const normalized = normalizeModelToken(model);
    return normalized.length > 0 ? [normalized] : [];
  }

  const tokens = new Set<string>();
  const normalizedId = normalizeModelToken(model.id);
  const normalizedName = normalizeModelToken(model.name);

  if (normalizedId.length > 0) {
    tokens.add(normalizedId);
  }
  if (normalizedName.length > 0) {
    tokens.add(normalizedName);
  }

  return [...tokens];
}

/**
 * Pick the best model from a list according to {@link PREFERRED_MODEL_ALIASES}.
 * Accepts either plain string ids or Model-like objects.
 * Falls back to the first element when nothing matches.
 */
export function selectPreferredModel<
  T extends string | { id: string; name: string },
>(models: T[]): T | undefined {
  for (const aliases of PREFERRED_MODEL_ALIASES) {
    const match = models.find((m) => {
      const tokens = getModelSearchTokens(m);
      return aliases.some((alias) => {
        const normalizedAlias = normalizeModelToken(alias);
        return tokens.some((token) => token.includes(normalizedAlias));
      });
    });
    if (match) return match;
  }
  return models[0];
}
