import { z } from "zod";

export const skillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  longDescription: z.string().optional(),
  tag: z
    .enum([
      "office-collab",
      "file-knowledge",
      "creative-design",
      "biz-analysis",
      "av-generation",
      "info-content",
      "dev-tools",
    ])
    .default("dev-tools"),
  icon: z.string().default("Sparkles"),
  source: z.enum(["official", "community", "custom"]).default("custom"),
  examples: z.array(z.string()).optional(),
  prompt: z.string().default(""),
  requires: z
    .object({
      tools: z.array(z.string()).optional(),
      plugins: z.array(z.string()).optional(),
    })
    .optional(),
});

export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;
