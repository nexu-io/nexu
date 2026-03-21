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

/**
 * Preferred models for auto-selection, in priority order (lowercase).
 * Substring-matched against model id/name so it works with both
 * raw ids ("gemini-3-pro") and prefixed ids ("google/gemini-3-pro").
 */
const PREFERRED_MODEL_PATTERNS: string[] = [
  "gemini-3-pro",
  "gemini-2.5-pro",
  "claude-sonnet-4",
  "gpt-5",
];

/**
 * Pick the best model from a list according to {@link PREFERRED_MODEL_PATTERNS}.
 * Accepts either plain string ids or Model-like objects.
 * Falls back to the first element when nothing matches.
 */
export function selectPreferredModel<
  T extends string | { id: string; name: string },
>(models: T[]): T | undefined {
  for (const pattern of PREFERRED_MODEL_PATTERNS) {
    const match = models.find((m) => {
      if (typeof m === "string") {
        return m.toLowerCase().includes(pattern);
      }
      return (
        m.id.toLowerCase().includes(pattern) ||
        m.name.toLowerCase().includes(pattern)
      );
    });
    if (match) return match;
  }
  return models[0];
}
