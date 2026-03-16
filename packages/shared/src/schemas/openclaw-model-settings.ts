import { z } from "zod";

export const openclawProviderModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  enabled: z.boolean(),
});

export const openclawModelProviderResponseSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().nullable().optional(),
  apiKeyConfigured: z.boolean(),
  models: z.array(openclawProviderModelSchema),
});

export const openclawModelSettingsResponseSchema = z.object({
  poolId: z.string(),
  updatedAt: z.string().nullable(),
  providers: z.record(z.string(), openclawModelProviderResponseSchema),
});

export const updateOpenclawModelProviderSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().nullable().optional(),
  apiKey: z.string().min(1).optional(),
  clearApiKey: z.boolean().optional(),
  models: z.array(openclawProviderModelSchema),
});

export const updateOpenclawModelSettingsSchema = z.object({
  providers: z.record(z.string(), updateOpenclawModelProviderSchema),
});

export const updateOpenclawModelSettingsResponseSchema = z.object({
  ok: z.boolean(),
  poolId: z.string(),
  updatedAt: z.string(),
  publishedVersion: z.number().int().nonnegative(),
});

export type OpenClawProviderModel = z.infer<typeof openclawProviderModelSchema>;
export type OpenClawModelProviderResponse = z.infer<
  typeof openclawModelProviderResponseSchema
>;
export type OpenClawModelSettingsResponse = z.infer<
  typeof openclawModelSettingsResponseSchema
>;
export type UpdateOpenClawModelProvider = z.infer<
  typeof updateOpenclawModelProviderSchema
>;
export type UpdateOpenClawModelSettingsInput = z.infer<
  typeof updateOpenclawModelSettingsSchema
>;
