import { openclawConfigSchema } from "@nexu/shared";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../db/schema/index.js";
import { generatePoolConfig } from "../config-generator.js";
import { encrypt } from "../crypto.js";

process.env.ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GATEWAY_TOKEN = "test-gw-token";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function createTables(client: pg.Pool) {
  await client.query(`
    DROP TABLE IF EXISTS webhook_routes CASCADE;
    DROP TABLE IF EXISTS gateway_assignments CASCADE;
    DROP TABLE IF EXISTS pool_config_snapshots CASCADE;
    DROP TABLE IF EXISTS usage_metrics CASCADE;
    DROP TABLE IF EXISTS users CASCADE;
    DROP TABLE IF EXISTS channel_credentials CASCADE;
    DROP TABLE IF EXISTS bot_channels CASCADE;
    DROP TABLE IF EXISTS gateway_pools CASCADE;
    DROP TABLE IF EXISTS bots CASCADE;
    DROP TABLE IF EXISTS invite_codes CASCADE;

    CREATE TABLE bots (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      system_prompt TEXT,
      model_id TEXT DEFAULT 'anthropic/claude-sonnet-4-6',
      agent_config TEXT DEFAULT '{}',
      tools_config TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      pool_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX bots_user_slug_idx ON bots(user_id, slug);

    CREATE TABLE bot_channels (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      account_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      channel_config TEXT DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX bot_channels_uniq_idx ON bot_channels(bot_id, channel_type, account_id);

    CREATE TABLE channel_credentials (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_channel_id TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX cred_uniq_idx ON channel_credentials(bot_channel_id, credential_type);

    CREATE TABLE gateway_pools (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      pool_name TEXT NOT NULL UNIQUE,
      pool_type TEXT DEFAULT 'shared',
      max_bots INTEGER DEFAULT 50,
      current_bots INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      config_version INTEGER DEFAULT 0,
      pod_ip TEXT,
      last_heartbeat TEXT,
      last_seen_version INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE gateway_assignments (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE webhook_routes (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      channel_type TEXT NOT NULL,
      external_id TEXT NOT NULL,
      pool_id TEXT NOT NULL,
      bot_channel_id TEXT NOT NULL,
      bot_id TEXT,
      account_id TEXT,
      runtime_url TEXT,
      updated_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX webhook_routes_uniq_idx ON webhook_routes(channel_type, external_id);

    CREATE TABLE pool_config_snapshots (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      config_hash TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX pool_config_snapshots_pool_version_idx ON pool_config_snapshots(pool_id, version);
    CREATE UNIQUE INDEX pool_config_snapshots_pool_hash_idx ON pool_config_snapshots(pool_id, config_hash);
  `);
}

async function truncateAll(client: pg.Pool) {
  await client.query(
    "TRUNCATE bots, bot_channels, channel_credentials, gateway_pools, gateway_assignments, webhook_routes, pool_config_snapshots CASCADE",
  );
}

async function seedData() {
  const now = new Date().toISOString();

  await db.insert(schema.gatewayPools).values({
    id: "pool-1",
    poolName: "default",
    poolType: "shared",
    status: "active",
    createdAt: now,
  });

  await db.insert(schema.bots).values({
    id: "bot-1",
    userId: "user-1",
    name: "Acme Bot",
    slug: "acme-bot",
    modelId: "anthropic/claude-sonnet-4-6",
    systemPrompt: "You are a helpful assistant",
    status: "active",
    poolId: "pool-1",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.bots).values({
    id: "bot-2",
    userId: "user-2",
    name: "Globex Bot",
    slug: "globex-bot",
    modelId: "anthropic/claude-opus-4-6",
    status: "active",
    poolId: "pool-1",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.botChannels).values({
    id: "ch-1",
    botId: "bot-1",
    channelType: "slack",
    accountId: "slack-T123",
    status: "connected",
    channelConfig: JSON.stringify({ teamId: "T123", teamName: "Acme" }),
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.channelCredentials).values({
    id: "cred-1",
    botChannelId: "ch-1",
    credentialType: "botToken",
    encryptedValue: encrypt("xoxb-acme-token-123"),
    createdAt: now,
  });

  await db.insert(schema.channelCredentials).values({
    id: "cred-2",
    botChannelId: "ch-1",
    credentialType: "signingSecret",
    encryptedValue: encrypt("acme-signing-secret"),
    createdAt: now,
  });

  await db.insert(schema.botChannels).values({
    id: "ch-2",
    botId: "bot-2",
    channelType: "slack",
    accountId: "slack-T456",
    status: "connected",
    channelConfig: JSON.stringify({ teamId: "T456", teamName: "Globex" }),
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.channelCredentials).values({
    id: "cred-3",
    botChannelId: "ch-2",
    credentialType: "botToken",
    encryptedValue: encrypt("xoxb-globex-token-456"),
    createdAt: now,
  });

  await db.insert(schema.channelCredentials).values({
    id: "cred-4",
    botChannelId: "ch-2",
    credentialType: "signingSecret",
    encryptedValue: encrypt("globex-signing-secret"),
    createdAt: now,
  });
}

describe("Config Generator", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool, { schema });
    await createTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateAll(pool);
  });

  it("should throw error for non-existent pool", async () => {
    await expect(generatePoolConfig(db, "non-existent")).rejects.toThrow(
      "Pool non-existent not found",
    );
  });

  it("should generate empty config for pool with no bots", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.gatewayPools).values({
      id: "empty-pool",
      poolName: "empty",
      poolType: "shared",
      status: "active",
      createdAt: now,
    });

    const config = await generatePoolConfig(db, "empty-pool");

    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.mode).toBe("local");
    expect(config.gateway.bind).toBe("lan");
    expect(config.agents.list).toHaveLength(0);
    expect(config.bindings).toHaveLength(0);

    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should generate valid config with multiple bots and slack channels", async () => {
    await seedData();

    const config = await generatePoolConfig(db, "pool-1");

    expect(config.agents.list).toHaveLength(2);

    const agent1 = config.agents.list[0];
    expect(agent1).toBeDefined();
    expect(agent1?.id).toBe("acme-bot");
    expect(agent1?.name).toBe("Acme Bot");
    expect(agent1?.default).toBe(true);

    const agent2 = config.agents.list[1];
    expect(agent2).toBeDefined();
    expect(agent2?.id).toBe("globex-bot");
    expect(agent2?.name).toBe("Globex Bot");
    expect(agent2?.default).toBeUndefined();
    expect(agent2?.model).toEqual({ primary: "anthropic/claude-opus-4-6" });

    expect(config.channels.slack).toBeDefined();
    const slack = config.channels.slack;
    if (!slack) throw new Error("slack should be defined");
    const slackAccounts = slack.accounts;

    expect(slackAccounts["slack-T123"]).toBeDefined();
    expect(slackAccounts["slack-T123"]?.botToken).toBe("xoxb-acme-token-123");
    expect(slackAccounts["slack-T123"]?.signingSecret).toBe(
      "acme-signing-secret",
    );
    expect(slackAccounts["slack-T123"]?.mode).toBe("http");
    expect(slackAccounts["slack-T123"]?.webhookPath).toBe(
      "/slack/events/slack-T123",
    );

    expect(slackAccounts["slack-T456"]).toBeDefined();
    expect(slackAccounts["slack-T456"]?.botToken).toBe("xoxb-globex-token-456");

    expect(config.bindings).toHaveLength(2);
    expect(config.bindings[0]).toEqual({
      agentId: "acme-bot",
      match: { channel: "slack", accountId: "slack-T123" },
    });
    expect(config.bindings[1]).toEqual({
      agentId: "globex-bot",
      match: { channel: "slack", accountId: "slack-T456" },
    });

    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("should use accountId as the accounts key, not teamId", async () => {
    await seedData();
    const config = await generatePoolConfig(db, "pool-1");

    const slack = config.channels.slack;
    if (!slack) throw new Error("slack should be defined");
    const slackAccounts = slack.accounts;
    expect(slackAccounts["slack-T123"]).toBeDefined();
    expect(slackAccounts.T123).toBeUndefined();

    const binding = config.bindings.find((b) => b.agentId === "acme-bot");
    expect(binding).toBeDefined();
    expect(binding?.match.accountId).toBe("slack-T123");
  });

  it("should only include active bots", async () => {
    await seedData();

    await db.update(schema.bots).set({ status: "paused" });

    await db
      .update(schema.bots)
      .set({ status: "active" })
      .where(eq(schema.bots.id, "bot-1"));

    const config = await generatePoolConfig(db, "pool-1");

    expect(config.agents.list).toHaveLength(1);
    expect(config.agents.list[0]?.id).toBe("acme-bot");
  });

  it("should only include connected channels", async () => {
    await seedData();

    await db
      .update(schema.botChannels)
      .set({ status: "disconnected" })
      .where(eq(schema.botChannels.id, "ch-2"));

    const config = await generatePoolConfig(db, "pool-1");

    expect(config.bindings).toHaveLength(1);
    expect(config.bindings[0]?.agentId).toBe("acme-bot");
  });

  it("should have only one default agent", async () => {
    await seedData();
    const config = await generatePoolConfig(db, "pool-1");

    const defaultAgents = config.agents.list.filter((a) => a.default === true);
    expect(defaultAgents).toHaveLength(1);
  });

  it("should resolve pool by name when id doesn't match", async () => {
    await seedData();
    const config = await generatePoolConfig(db, "default");

    expect(config.agents.list).toHaveLength(2);
    expect(config.agents.list[0]?.id).toBe("acme-bot");
  });

  it("should use custom gateway token", async () => {
    await seedData();
    const config = await generatePoolConfig(db, "pool-1", "custom-token");

    expect(config.gateway.auth.token).toBe("custom-token");
  });

  it("should pass Zod validation on generated config", async () => {
    await seedData();
    const config = await generatePoolConfig(db, "pool-1");

    const result = openclawConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });
});
