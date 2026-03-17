import { z } from "zod";

export const skillTagSchema = z.enum([
  "office-collab",
  "file-knowledge",
  "creative-design",
  "biz-analysis",
  "av-generation",
  "info-content",
  "dev-tools",
]);

export const skillSourceSchema = z.enum(["official", "custom", "community"]);

export const skillToolRefSchema = z.object({
  slug: z.string(),
  name: z.string(),
  provider: z.string(),
  iconUrl: z.string(),
  fallbackIconUrl: z.string(),
});

export const skillInfoSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  longDescription: z.string().optional(),
  iconName: z.string(),
  iconUrl: z.string().optional(),
  fallbackIconUrl: z.string().optional(),
  prompt: z.string(),
  examples: z.array(z.string()).optional(),
  tag: skillTagSchema,
  source: skillSourceSchema,
  tools: z.array(skillToolRefSchema).optional(),
  githubUrl: z.string().optional(),
  installed: z.boolean().optional(),
  updatable: z.boolean().optional(),
});

export const skillListResponseSchema = z.object({
  skills: z.array(skillInfoSchema),
  tags: z.array(
    z.object({
      id: skillTagSchema,
      label: z.string(),
      count: z.number(),
    }),
  ),
});

export const skillToolWithStatusSchema = z.object({
  slug: z.string(),
  name: z.string(),
  provider: z.string(),
  iconUrl: z.string(),
  fallbackIconUrl: z.string(),
  authScheme: z.string(),
  status: z.enum(["connected", "not_connected", "initiated", "expired"]),
  integrationId: z.string().optional(),
});

export const skillDetailResponseSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  longDescription: z.string().optional(),
  iconName: z.string(),
  iconUrl: z.string().optional(),
  fallbackIconUrl: z.string().optional(),
  prompt: z.string(),
  examples: z.array(z.string()).optional(),
  tag: skillTagSchema,
  source: skillSourceSchema,
  tools: z.array(skillToolWithStatusSchema).optional(),
  githubUrl: z.string().optional(),
  relatedSkills: z.array(skillInfoSchema).optional(),
});
