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
