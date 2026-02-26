import {
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const bots = pgTable(
  "bots",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    systemPrompt: text("system_prompt"),
    modelId: text("model_id").default("anthropic/claude-sonnet-4-6"),
    agentConfig: text("agent_config").default("{}"),
    toolsConfig: text("tools_config").default("{}"),
    status: text("status").default("active"),
    poolId: text("pool_id"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [uniqueIndex("bots_user_slug_idx").on(table.userId, table.slug)],
);

export const botChannels = pgTable(
  "bot_channels",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    botId: text("bot_id").notNull(),
    channelType: text("channel_type").notNull(),
    accountId: text("account_id").notNull(),
    status: text("status").default("pending"),
    channelConfig: text("channel_config").default("{}"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("bot_channels_uniq_idx").on(
      table.botId,
      table.channelType,
      table.accountId,
    ),
  ],
);

export const channelCredentials = pgTable(
  "channel_credentials",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    botChannelId: text("bot_channel_id").notNull(),
    credentialType: text("credential_type").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("cred_uniq_idx").on(table.botChannelId, table.credentialType),
  ],
);

export const gatewayPools = pgTable("gateway_pools", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  poolName: text("pool_name").notNull().unique(),
  poolType: text("pool_type").default("shared"),
  maxBots: integer("max_bots").default(50),
  currentBots: integer("current_bots").default(0),
  status: text("status").default("pending"),
  configVersion: integer("config_version").default(0),
  podIp: text("pod_ip"),
  lastHeartbeat: text("last_heartbeat"),
  lastSeenVersion: integer("last_seen_version").default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const gatewayAssignments = pgTable("gateway_assignments", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  botId: text("bot_id").notNull().unique(),
  poolId: text("pool_id").notNull(),
  assignedAt: text("assigned_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const users = pgTable("users", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  authUserId: text("auth_user_id").notNull().unique(),
  plan: text("plan").default("free"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const usageMetrics = pgTable("usage_metrics", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  botId: text("bot_id").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  messageCount: integer("message_count").default(0),
  tokenCount: integer("token_count").default(0),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const webhookRoutes = pgTable(
  "webhook_routes",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    channelType: text("channel_type").notNull(),
    externalId: text("external_id").notNull(),
    poolId: text("pool_id").notNull(),
    botChannelId: text("bot_channel_id").notNull(),
    botId: text("bot_id"),
    accountId: text("account_id"),
    runtimeUrl: text("runtime_url"),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("webhook_routes_uniq_idx").on(
      table.channelType,
      table.externalId,
    ),
  ],
);

export const poolConfigSnapshots = pgTable(
  "pool_config_snapshots",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    poolId: text("pool_id").notNull(),
    version: integer("version").notNull(),
    configHash: text("config_hash").notNull(),
    configJson: text("config_json").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("pool_config_snapshots_pool_version_idx").on(
      table.poolId,
      table.version,
    ),
    uniqueIndex("pool_config_snapshots_pool_hash_idx").on(
      table.poolId,
      table.configHash,
    ),
  ],
);

export const oauthStates = pgTable("oauth_states", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  state: text("state").notNull().unique(),
  botId: text("bot_id").notNull(),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const inviteCodes = pgTable("invite_codes", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  code: text("code").notNull().unique(),
  maxUses: integer("max_uses").default(100),
  usedCount: integer("used_count").default(0),
  createdBy: text("created_by"),
  expiresAt: text("expires_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
