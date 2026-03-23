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

export const cloudProfileSchema = z.object({
  name: z.string().min(1),
  cloudUrl: z.string().url(),
  linkUrl: z.string().url(),
});

export const cloudProfileStatusSchema = cloudProfileSchema.extend({
  connected: z.boolean(),
  polling: z.boolean().optional(),
  userName: z.string().nullable().optional(),
  userEmail: z.string().nullable().optional(),
  connectedAt: z.string().nullable().optional(),
  modelCount: z.number().int().nonnegative(),
});

export const cloudStatusResponseSchema = z.object({
  connected: z.boolean(),
  polling: z.boolean().optional(),
  userName: z.string().nullable().optional(),
  userEmail: z.string().nullable().optional(),
  connectedAt: z.string().nullable().optional(),
  models: z.array(cloudModelSchema).optional(),
  cloudUrl: z.string(),
  linkUrl: z.string().nullable(),
  activeProfileName: z.string(),
  profiles: z.array(cloudProfileStatusSchema),
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

export const cloudProfileSelectBodySchema = z.object({
  name: z.string().min(1),
});

export const cloudProfilesImportBodySchema = z.object({
  profiles: z.array(cloudProfileSchema),
});

export const cloudProfileCreateBodySchema = z.object({
  profile: cloudProfileSchema,
});

export const cloudProfileUpdateBodySchema = z.object({
  previousName: z.string().min(1),
  profile: cloudProfileSchema,
});

export const cloudProfileDeleteBodySchema = z.object({
  name: z.string().min(1),
});

export const cloudProfileConnectBodySchema = z.object({
  name: z.string().min(1),
});

export const cloudProfileDisconnectBodySchema = z.object({
  name: z.string().min(1),
});

export const cloudProfileSelectResponseSchema =
  cloudStatusResponseSchema.extend({
    ok: z.boolean(),
    configPushed: z.boolean(),
  });

export const cloudProfilesImportResponseSchema =
  cloudStatusResponseSchema.extend({
    ok: z.boolean(),
    configPushed: z.boolean(),
  });

export const cloudProfileCreateResponseSchema =
  cloudStatusResponseSchema.extend({
    ok: z.boolean(),
    configPushed: z.boolean(),
  });

export const cloudProfileUpdateResponseSchema =
  cloudStatusResponseSchema.extend({
    ok: z.boolean(),
    configPushed: z.boolean(),
  });

export const cloudProfileDeleteResponseSchema =
  cloudStatusResponseSchema.extend({
    ok: z.boolean(),
    configPushed: z.boolean(),
  });

export const cloudProfileConnectResponseSchema = z.object({
  browserUrl: z.string().optional(),
  error: z.string().optional(),
  status: cloudStatusResponseSchema,
  configPushed: z.boolean(),
});

export const cloudProfileDisconnectResponseSchema =
  cloudStatusResponseSchema.extend({
    ok: z.boolean(),
    configPushed: z.boolean(),
  });

export const cloudModelsBodySchema = z.object({
  enabledModelIds: z.array(z.string()),
});

export const cloudModelsResponseSchema = z.object({
  ok: z.boolean(),
  models: z.array(cloudModelSchema).optional(),
});
