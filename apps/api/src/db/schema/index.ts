import {
  boolean,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// better-auth managed core auth tables (FKs intentionally preserved)
export const authUsers = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("emailVerified").notNull().default(false),
    image: text("image"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (table) => [unique("user_email_key").on(table.email)],
);

export const authSessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt").notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId").notNull(),
  },
  (table) => [
    unique("session_token_key").on(table.token),
    foreignKey({
      name: "session_userId_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }),
  ],
);

export const authAccounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId").notNull(),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
    updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "account_userId_fkey",
      columns: [table.userId],
      foreignColumns: [authUsers.id],
    }),
  ],
);

export const authVerifications = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});

export const bots = pgTable(
  "bots",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    systemPrompt: text("system_prompt"),
    modelId: text("model_id").default("anthropic/claude-sonnet-4"),
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
  inviteAcceptedAt: text("invite_accepted_at"),
  onboardingRole: text("onboarding_role"),
  onboardingCompany: text("onboarding_company"),
  onboardingUseCases: text("onboarding_use_cases"),
  onboardingReferralSource: text("onboarding_referral_source"),
  onboardingReferralDetail: text("onboarding_referral_detail"),
  onboardingChannelVotes: text("onboarding_channel_votes"),
  onboardingAvatar: text("onboarding_avatar"),
  onboardingAvatarVotes: text("onboarding_avatar_votes"),
  onboardingCompletedAt: text("onboarding_completed_at"),
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
    index("pool_config_snapshots_pool_hash_idx").on(
      table.poolId,
      table.configHash,
    ),
  ],
);

export const skills = pgTable("skills", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  name: text("name").notNull().unique(),
  content: text("content").notNull(),
  files: text("files").notNull().default("{}"),
  status: text("status").default("active"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const skillsSnapshots = pgTable("skills_snapshots", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  version: integer("version").notNull().unique(),
  skillsHash: text("skills_hash").notNull(),
  skillsJson: text("skills_json").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const oauthStates = pgTable("oauth_states", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  state: text("state").notNull().unique(),
  botId: text("bot_id"),
  userId: text("user_id").notNull(),
  expiresAt: text("expires_at").notNull(),
  usedAt: text("used_at"),
  returnTo: text("return_to"),
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

export const workspaceTemplates = pgTable("workspace_templates", {
  pk: serial("pk").primaryKey(),
  id: text("id").notNull().unique(),
  name: text("name").notNull().unique(),
  content: text("content").notNull(),
  writeMode: text("write_mode").notNull().default("seed"),
  status: text("status").default("active"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const workspaceTemplateSnapshots = pgTable(
  "workspace_template_snapshots",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    version: integer("version").notNull().unique(),
    templatesHash: text("templates_hash").notNull(),
    templatesJson: text("templates_json").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
);

export const artifacts = pgTable(
  "artifacts",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    botId: text("bot_id").notNull(),
    sessionKey: text("session_key"),
    channelType: text("channel_type"),
    channelId: text("channel_id"),
    title: text("title").notNull(),
    artifactType: text("artifact_type"),
    source: text("source"),
    contentType: text("content_type"),
    status: text("status").default("building"),
    previewUrl: text("preview_url"),
    deployTarget: text("deploy_target"),
    linesOfCode: integer("lines_of_code"),
    fileCount: integer("file_count"),
    durationMs: integer("duration_ms"),
    metadata: text("metadata"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("artifacts_bot_id_idx").on(table.botId),
    index("artifacts_session_key_idx").on(table.sessionKey),
    index("artifacts_status_idx").on(table.status),
    index("artifacts_created_at_idx").on(table.createdAt),
  ],
);

export const poolSecrets = pgTable(
  "pool_secrets",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    poolId: text("pool_id").notNull(),
    secretName: text("secret_name").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    scope: text("scope").notNull().default("pool"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    uniqueIndex("pool_secrets_uniq_idx").on(table.poolId, table.secretName),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    pk: serial("pk").primaryKey(),
    id: text("id").notNull().unique(),
    botId: text("bot_id").notNull(),
    sessionKey: text("session_key").notNull().unique(),
    channelType: text("channel_type"),
    channelId: text("channel_id"),
    title: text("title").notNull(),
    status: text("status").default("active"),
    messageCount: integer("message_count").default(0),
    lastMessageAt: text("last_message_at"),
    metadata: text("metadata"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text("updated_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("sessions_bot_id_idx").on(table.botId),
    index("sessions_status_idx").on(table.status),
    index("sessions_created_at_idx").on(table.createdAt),
    index("sessions_channel_type_idx").on(table.channelType),
  ],
);
