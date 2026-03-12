import { z } from "zod";

export const integrationStatusSchema = z.enum([
  "pending",
  "initiated",
  "active",
  "failed",
  "expired",
  "disconnected",
]);

export const authSchemeSchema = z.enum([
  "oauth2",
  "api_key_global",
  "api_key_user",
]);

export const authFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "secret"]),
  placeholder: z.string().optional(),
});

export const toolkitInfoSchema = z.object({
  slug: z.string(),
  displayName: z.string(),
  description: z.string(),
  iconUrl: z.string(),
  fallbackIconUrl: z.string(),
  category: z.string(),
  authScheme: authSchemeSchema,
  authFields: z.array(authFieldSchema).optional(),
});

export const integrationResponseSchema = z.object({
  id: z.string().optional(),
  toolkit: toolkitInfoSchema,
  status: integrationStatusSchema,
  connectUrl: z.string().optional(),
  connectedAt: z.string().optional(),
  credentialHints: z.record(z.string(), z.string()).optional(),
  returnTo: z.string().optional(),
  source: z.enum(["page", "chat"]).optional(),
});

export const integrationListResponseSchema = z.object({
  integrations: z.array(integrationResponseSchema),
});

export const connectIntegrationSchema = z.object({
  toolkitSlug: z.string(),
  credentials: z.record(z.string(), z.string()).optional(),
  source: z.enum(["page", "chat"]).optional(),
  returnTo: z.string().optional(),
});

export const connectIntegrationResponseSchema = z.object({
  integration: integrationResponseSchema,
  connectUrl: z.string().optional(),
  state: z.string().optional(),
});

export const refreshIntegrationSchema = z.object({
  state: z.string().optional(),
});
