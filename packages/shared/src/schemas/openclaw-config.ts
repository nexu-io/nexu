import { z } from "zod";

const gatewayAuthSchema = z.object({
  mode: z.enum(["none", "token"]),
  token: z.string().optional(),
});

const gatewayReloadSchema = z.object({
  mode: z.enum(["off", "hot", "hybrid"]),
});

const controlUiSchema = z
  .object({
    allowedOrigins: z.array(z.string()).optional(),
    dangerouslyAllowHostHeaderOriginFallback: z.boolean().optional(),
  })
  .optional();

const gatewayConfigSchema = z.object({
  port: z.number().default(18789),
  mode: z.literal("local").default("local"),
  bind: z.enum(["loopback", "lan", "auto"]).default("lan"),
  auth: gatewayAuthSchema,
  reload: gatewayReloadSchema.default({ mode: "hybrid" }),
  controlUi: controlUiSchema,
});

const agentModelSchema = z.union([
  z.string(),
  z.object({
    primary: z.string(),
    fallbacks: z.array(z.string()).optional(),
  }),
]);

const agentSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  default: z.boolean().optional(),
  workspace: z.string().optional(),
  model: agentModelSchema.optional(),
});

const compactionMemoryFlushSchema = z
  .object({
    enabled: z.boolean().optional(),
    softThresholdTokens: z.number().optional(),
    prompt: z.string().optional(),
  })
  .passthrough();

const compactionSchema = z
  .object({
    mode: z.enum(["default", "safeguard"]).optional(),
    reserveTokens: z.number().optional(),
    keepRecentTokens: z.number().optional(),
    reserveTokensFloor: z.number().optional(),
    maxHistoryShare: z.number().optional(),
    memoryFlush: compactionMemoryFlushSchema.optional(),
  })
  .passthrough();

const memorySearchRemoteSchema = z
  .object({
    baseUrl: z.string().optional(),
    apiKey: z.string().optional(),
  })
  .passthrough();

const memorySearchSchema = z
  .object({
    enabled: z.boolean().optional(),
    sources: z.array(z.enum(["memory", "sessions"])).optional(),
    provider: z
      .enum(["openai", "gemini", "local", "voyage", "mistral"])
      .optional(),
    model: z.string().optional(),
    remote: memorySearchRemoteSchema.optional(),
  })
  .passthrough();

const agentsConfigSchema = z.object({
  defaults: z
    .object({
      model: z
        .union([z.string(), z.object({ primary: z.string() })])
        .optional(),
      compaction: compactionSchema.optional(),
      memorySearch: memorySearchSchema.optional(),
    })
    .passthrough()
    .optional(),
  list: z.array(agentSchema),
});

const slackAccountSchema = z.object({
  enabled: z.boolean().default(true),
  botToken: z.string(),
  signingSecret: z.string().optional(),
  appToken: z.string().optional(),
  mode: z.enum(["socket", "http"]).default("http"),
  webhookPath: z.string().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  streaming: z.enum(["off", "partial", "block", "progress"]).optional(),
});

const slackChannelSchema = z.object({
  mode: z.enum(["socket", "http"]).optional(),
  signingSecret: z.string().optional(),
  enabled: z.boolean().optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  requireMention: z.boolean().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  allowFrom: z.array(z.string()).optional(),
  accounts: z.record(z.string(), slackAccountSchema),
});

const discordAccountSchema = z.object({
  enabled: z.boolean().default(true),
  token: z.string(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).default("open"),
});

const discordChannelSchema = z.object({
  enabled: z.boolean().optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  allowFrom: z.array(z.string()).optional(),
  accounts: z.record(z.string(), discordAccountSchema),
});

const feishuAccountSchema = z.object({
  enabled: z.boolean().default(true),
  appId: z.string(),
  appSecret: z.string(),
});

const feishuChannelSchema = z.object({
  enabled: z.boolean().optional(),
  connectionMode: z.enum(["websocket", "webhook"]).optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open"]).optional(),
  groupPolicy: z.enum(["open", "allowlist", "disabled"]).optional(),
  requireMention: z.boolean().optional(),
  allowFrom: z.array(z.string()).optional(),
  accounts: z.record(z.string(), feishuAccountSchema),
});

const channelsConfigSchema = z.object({
  slack: slackChannelSchema.optional(),
  discord: discordChannelSchema.optional(),
  feishu: feishuChannelSchema.optional(),
});

const bindingMatchSchema = z.object({
  channel: z.string(),
  accountId: z.string().optional(),
});

const bindingSchema = z.object({
  agentId: z.string(),
  match: bindingMatchSchema,
});

// Model provider configuration for LiteLLM / custom endpoints
const modelCompatSchema = z
  .object({
    supportsStore: z.boolean().optional(),
  })
  .passthrough();

const modelCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
});

const modelEntrySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  reasoning: z.boolean().optional(),
  input: z.array(z.string()).optional(),
  cost: modelCostSchema.optional(),
  contextWindow: z.number().optional(),
  maxTokens: z.number().optional(),
  compat: modelCompatSchema.optional(),
});

const modelProviderSchema = z
  .object({
    baseUrl: z.string(),
    apiKey: z.string(),
    api: z.string(),
    models: z.array(modelEntrySchema),
  })
  .passthrough();

const modelsConfigSchema = z.object({
  mode: z.enum(["merge", "replace"]).optional(),
  providers: z.record(z.string(), modelProviderSchema),
});

const commandsConfigSchema = z
  .object({
    native: z.enum(["auto", "off"]).optional(),
    nativeSkills: z.enum(["auto", "off"]).optional(),
    restart: z.boolean().optional(),
    ownerDisplay: z.enum(["raw", "friendly"]).optional(),
  })
  .passthrough();

const skillsLoadSchema = z
  .object({
    watch: z.boolean().optional(),
    watchDebounceMs: z.number().optional(),
    extraDirs: z.array(z.string()).optional(),
  })
  .passthrough();

const skillsConfigSchema = z
  .object({
    load: skillsLoadSchema.optional(),
  })
  .passthrough();

const toolsExecSchema = z
  .object({
    security: z.enum(["deny", "allowlist", "full"]).optional(),
    ask: z.enum(["off", "on-miss", "always"]).optional(),
    host: z.enum(["sandbox", "gateway", "node"]).optional(),
  })
  .passthrough();

const toolsWebSearchSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough();

const toolsWebFetchSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough();

const toolsWebSchema = z
  .object({
    search: toolsWebSearchSchema.optional(),
    fetch: toolsWebFetchSchema.optional(),
  })
  .passthrough();

const toolsConfigSchema = z
  .object({
    exec: toolsExecSchema.optional(),
    web: toolsWebSchema.optional(),
  })
  .passthrough();

const cronConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .passthrough();

export const openclawConfigSchema = z.object({
  gateway: gatewayConfigSchema,
  models: modelsConfigSchema.optional(),
  tools: toolsConfigSchema.optional(),
  skills: skillsConfigSchema.optional(),
  agents: agentsConfigSchema,
  channels: channelsConfigSchema,
  bindings: z.array(bindingSchema),
  commands: commandsConfigSchema.optional(),
  cron: cronConfigSchema.optional(),
});

export type OpenClawConfig = z.infer<typeof openclawConfigSchema>;
export type AgentConfig = z.infer<typeof agentSchema>;
export type SlackAccountConfig = z.infer<typeof slackAccountSchema>;
export type DiscordAccountConfig = z.infer<typeof discordAccountSchema>;
export type FeishuAccountConfig = z.infer<typeof feishuAccountSchema>;
export type BindingConfig = z.infer<typeof bindingSchema>;
