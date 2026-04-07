import { z } from "zod";
import {
  modelApiSchema,
  persistedModelsConfigSchema,
  persistedProviderAuthModeSchema,
} from "./model-provider-config.js";

export const providerRegistryEntrySchema = z.object({
  id: z.string().min(1),
  canonicalOpenClawId: z.string().min(1),
  aliases: z.array(z.string()),
  authModes: z.array(persistedProviderAuthModeSchema),
  apiKind: modelApiSchema,
  defaultBaseUrls: z.array(z.string()),
  controllerConfigurable: z.boolean().optional(),
  modelsPageVisible: z.boolean().optional(),
  region: z.enum(["global", "china", "local"]).optional(),
  signupUrl: z.string().optional(),
  supportsCustomBaseUrl: z.boolean().optional(),
  supportsModelDiscovery: z.boolean().optional(),
  supportsProxyMode: z.boolean().optional(),
  managedByAuthProfiles: z.boolean().optional(),
  requiresOauthRegion: z.boolean().optional(),
  authHeader: z.boolean().optional(),
  defaultHeaders: z.record(z.string(), z.string()).optional(),
  experimental: z.boolean().optional(),
  hidden: z.boolean().optional(),
  displayName: z.string().min(1),
  displayNameKey: z.string().optional(),
  descriptionKey: z.string().optional(),
  apiDocsUrl: z.string().optional(),
  apiKeyPlaceholder: z.string().optional(),
  defaultProxyUrl: z.string().optional(),
  logo: z.string().optional(),
});

export const providerRegistryResponseSchema = z.object({
  registry: z.array(providerRegistryEntrySchema),
});

export const modelProviderConfigDocumentEnvelopeSchema = z.object({
  config: persistedModelsConfigSchema,
});

export type ProviderRegistryEntryDto = z.infer<
  typeof providerRegistryEntrySchema
>;
