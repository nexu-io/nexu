import {
  botResponseSchema,
  channelResponseSchema,
  integrationResponseSchema,
  providerResponseSchema,
} from "@nexu/shared";
import { z } from "zod";

export const controllerRuntimeConfigSchema = z
  .object({
    gateway: z
      .object({
        port: z.number().int().positive().default(18789),
        bind: z.enum(["loopback", "lan", "auto"]).default("loopback"),
        authMode: z.enum(["none", "token"]).default("none"),
      })
      .default({ port: 18789, bind: "loopback", authMode: "none" }),
    defaultModelId: z.string().default("anthropic/claude-sonnet-4"),
  })
  .passthrough();

export const controllerProviderSchema = z.object({
  id: z.string(),
  providerId: z.string(),
  displayName: z.string().nullable(),
  enabled: z.boolean(),
  baseUrl: z.string().nullable(),
  apiKey: z.string().nullable(),
  models: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const controllerProviderInputSchema = z.object({
  apiKey: z.string().nullable().optional(),
  baseUrl: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  displayName: z.string().optional(),
  modelsJson: z.string().optional(),
});

export const storedProviderResponseSchema = providerResponseSchema.extend({
  apiKey: z.string().nullable().optional(),
  models: z.array(z.string()).optional(),
});

export const controllerTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  writeMode: z.enum(["seed", "inject"]).default("seed"),
  status: z.enum(["active", "inactive"]).default("active"),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const controllerTemplateUpsertBodySchema = z.object({
  content: z.string().min(1),
  writeMode: z.enum(["seed", "inject"]).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

export const controllerSkillItemSchema = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  source: z.enum(["inline", "local-path"]).default("inline"),
  content: z.string().default(""),
  localPath: z.string().optional(),
  files: z.record(z.string(), z.string()).default({}),
  metadata: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      owner: z.string().optional(),
      tags: z.array(z.string()).optional(),
      category: z.string().optional(),
    })
    .default({}),
});

export const controllerSkillsSchema = z.object({
  version: z.number().int().positive().default(1),
  defaults: z
    .object({
      enabled: z.boolean().default(true),
      source: z.enum(["inline", "local-path"]).default("inline"),
    })
    .default({ enabled: true, source: "inline" }),
  items: z.record(z.string(), controllerSkillItemSchema).default({}),
});

export const controllerSkillUpsertBodySchema = z.object({
  content: z.string().min(1),
  files: z.record(z.string(), z.string()).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  metadata: controllerSkillItemSchema.shape.metadata.optional(),
});

export const controllerArtifactSchema = z.object({
  id: z.string(),
  botId: z.string(),
  title: z.string(),
  sessionKey: z.string().nullable(),
  channelType: z.string().nullable(),
  channelId: z.string().nullable(),
  artifactType: z.string().nullable(),
  source: z.string().nullable(),
  contentType: z.string().nullable(),
  status: z.string(),
  previewUrl: z.string().nullable(),
  deployTarget: z.string().nullable(),
  linesOfCode: z.number().nullable(),
  fileCount: z.number().nullable(),
  durationMs: z.number().nullable(),
  metadata: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const nexuConfigObjectSchema = z.object({
  $schema: z.string(),
  schemaVersion: z.number().int().positive(),
  app: z.record(z.unknown()).default({}),
  bots: z.array(botResponseSchema).default([]),
  runtime: controllerRuntimeConfigSchema,
  providers: z.array(controllerProviderSchema).default([]),
  integrations: z.array(integrationResponseSchema).default([]),
  channels: z.array(channelResponseSchema).default([]),
  templates: z.record(z.string(), controllerTemplateSchema).default({}),
  skills: controllerSkillsSchema,
  desktop: z.record(z.unknown()).default({}),
  secrets: z.record(z.string(), z.string()).default({}),
});

export const nexuConfigSchema = z.preprocess((input) => {
  if (typeof input !== "object" || input === null) {
    return input;
  }

  const candidate = input as Record<string, unknown>;
  return {
    $schema:
      typeof candidate.$schema === "string"
        ? candidate.$schema
        : "https://nexu.io/config.json",
    schemaVersion:
      typeof candidate.schemaVersion === "number" ? candidate.schemaVersion : 1,
    app:
      typeof candidate.app === "object" && candidate.app !== null
        ? candidate.app
        : {},
    bots: Array.isArray(candidate.bots) ? candidate.bots : [],
    runtime:
      typeof candidate.runtime === "object" && candidate.runtime !== null
        ? candidate.runtime
        : {},
    providers: Array.isArray(candidate.providers) ? candidate.providers : [],
    integrations: Array.isArray(candidate.integrations)
      ? candidate.integrations
      : [],
    channels: Array.isArray(candidate.channels) ? candidate.channels : [],
    templates:
      typeof candidate.templates === "object" && candidate.templates !== null
        ? candidate.templates
        : {},
    skills:
      typeof candidate.skills === "object" && candidate.skills !== null
        ? candidate.skills
        : {},
    desktop:
      typeof candidate.desktop === "object" && candidate.desktop !== null
        ? candidate.desktop
        : {},
    secrets:
      typeof candidate.secrets === "object" && candidate.secrets !== null
        ? candidate.secrets
        : {},
  };
}, nexuConfigObjectSchema);

export const artifactsIndexSchema = z.object({
  schemaVersion: z.number().int().positive(),
  artifacts: z.array(controllerArtifactSchema).default([]),
});

export const compiledOpenClawSnapshotSchema = z.object({
  updatedAt: z.string(),
  config: z.record(z.unknown()),
});

export type NexuConfig = z.infer<typeof nexuConfigSchema>;
export type ControllerRuntimeConfig = z.infer<
  typeof controllerRuntimeConfigSchema
>;
export type ControllerProvider = z.infer<typeof controllerProviderSchema>;
export type ControllerSkillItem = z.infer<typeof controllerSkillItemSchema>;
export type ControllerSkills = z.infer<typeof controllerSkillsSchema>;
export type ControllerArtifact = z.infer<typeof controllerArtifactSchema>;
export type ArtifactsIndex = z.infer<typeof artifactsIndexSchema>;
