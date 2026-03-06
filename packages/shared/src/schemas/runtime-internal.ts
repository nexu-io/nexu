import { z } from "zod";
import { openclawConfigSchema } from "./openclaw-config.js";

export const runtimePoolStatusSchema = z.enum([
  "pending",
  "active",
  "degraded",
  "unhealthy",
  "draining",
  "terminated",
]);

export const runtimePoolRegisterSchema = z.object({
  poolId: z.string().min(1),
  podIp: z.string().min(1).optional(),
  status: runtimePoolStatusSchema.default("active"),
});

export const runtimePoolHeartbeatSchema = z.object({
  poolId: z.string().min(1),
  podIp: z.string().min(1).optional(),
  status: runtimePoolStatusSchema.default("active"),
  lastSeenVersion: z.number().int().nonnegative().optional(),
  timestamp: z.string().datetime().optional(),
});

export const runtimePoolConfigResponseSchema = z.object({
  poolId: z.string(),
  version: z.number().int().nonnegative(),
  configHash: z.string(),
  config: openclawConfigSchema,
  agentMeta: z.record(z.object({ botId: z.string() })).optional(),
  poolSecrets: z.record(z.string()).optional(),
  secretsHash: z.string().optional(),
  createdAt: z.string(),
});

export const runtimePoolRegisterResponseSchema = z.object({
  ok: z.boolean(),
  poolId: z.string(),
});

export const runtimePoolHeartbeatResponseSchema = z.object({
  ok: z.boolean(),
  poolId: z.string(),
  status: runtimePoolStatusSchema,
});

export type RuntimePoolStatus = z.infer<typeof runtimePoolStatusSchema>;
export type RuntimePoolRegisterInput = z.infer<
  typeof runtimePoolRegisterSchema
>;
export type RuntimePoolHeartbeatInput = z.infer<
  typeof runtimePoolHeartbeatSchema
>;
export type RuntimePoolConfigResponse = z.infer<
  typeof runtimePoolConfigResponseSchema
>;

export const runtimeSkillsResponseSchema = z.object({
  version: z.number().int().nonnegative(),
  skillsHash: z.string(),
  skills: z.record(z.record(z.string())),
  createdAt: z.string().datetime(),
});

export type RuntimeSkillsResponse = z.infer<typeof runtimeSkillsResponseSchema>;

export const runtimeWorkspaceTemplatesResponseSchema = z.object({
  version: z.number().int().nonnegative(),
  templatesHash: z.string(),
  templates: z.record(
    z.object({
      content: z.string(),
      writeMode: z.enum(["seed", "inject"]),
    }),
  ),
  createdAt: z.string().datetime(),
});

export type RuntimeWorkspaceTemplatesResponse = z.infer<
  typeof runtimeWorkspaceTemplatesResponseSchema
>;

export const slackTokenHealthCheckResponseSchema = z.object({
  checked: z.number().int(),
  invalidated: z.number().int(),
  results: z.array(
    z.object({
      botChannelId: z.string(),
      accountId: z.string(),
      ok: z.boolean(),
      error: z.string().optional(),
    }),
  ),
});

export type SlackTokenHealthCheckResponse = z.infer<
  typeof slackTokenHealthCheckResponseSchema
>;
