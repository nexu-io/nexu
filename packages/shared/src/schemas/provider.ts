import { z } from "zod";

// ── Provider CRUD ────────────────────────────────────────────────

export const providerResponseSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  displayName: z.string().nullable(),
  enabled: z.boolean(),
  baseUrl: z.string().nullable(),
  hasApiKey: z.boolean(),
  modelsJson: z.string().nullable(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const providerListResponseSchema = z.object({
  providers: z.array(providerResponseSchema),
});

export const upsertProviderBodySchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  displayName: z.string().optional(),
  modelsJson: z.string().optional(),
});

export const verifyProviderBodySchema = z.object({
  apiKey: z.string(),
  baseUrl: z.string().optional(),
});

export const refreshModelsResponseSchema = z.object({
  models: z.array(z.string()),
  error: z.string().optional(),
});

export const verifyProviderResponseSchema = z.object({
  valid: z.boolean(),
  models: z.array(z.string()).optional(),
  error: z.string().optional(),
});

// ── Desktop Cloud ────────────────────────────────────────────────

export const cloudModelSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string().optional(),
});

export const cloudStatusResponseSchema = z.object({
  connected: z.boolean(),
  polling: z.boolean().optional(),
  userName: z.string().nullable().optional(),
  userEmail: z.string().nullable().optional(),
  connectedAt: z.string().nullable().optional(),
  models: z.array(cloudModelSchema).optional(),
});

export const cloudConnectResponseSchema = z.object({
  browserUrl: z.string().optional(),
  error: z.string().optional(),
});

export const cloudRefreshResponseSchema = cloudStatusResponseSchema.extend({
  configPushed: z.boolean(),
});

export const cloudDisconnectResponseSchema = z.object({
  ok: z.boolean(),
});

export const cloudModelsBodySchema = z.object({
  enabledModelIds: z.array(z.string()),
});

export const cloudModelsResponseSchema = z.object({
  ok: z.boolean(),
  models: z.array(cloudModelSchema).optional(),
});
