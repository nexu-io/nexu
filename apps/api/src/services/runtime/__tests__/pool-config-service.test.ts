import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../../db/schema/index.js";
import { encrypt } from "../../../lib/crypto.js";
import {
  getLatestPoolConfigSnapshot,
  getPoolConfigSnapshotByVersion,
  publishPoolConfigSnapshot,
} from "../pool-config-service.js";

process.env.ENCRYPTION_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.GATEWAY_TOKEN = "test-gw-token";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

let pool: pg.Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;

async function resetTables(client: pg.Pool) {
  await client.query(`
    DROP TABLE IF EXISTS pool_config_snapshots CASCADE;
    DROP TABLE IF EXISTS webhook_routes CASCADE;
    DROP TABLE IF EXISTS gateway_assignments CASCADE;
    DROP TABLE IF EXISTS channel_credentials CASCADE;
    DROP TABLE IF EXISTS bot_channels CASCADE;
    DROP TABLE IF EXISTS gateway_pools CASCADE;
    DROP TABLE IF EXISTS bots CASCADE;

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

    CREATE TABLE channel_credentials (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_channel_id TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

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

async function seedPoolData() {
  const now = new Date().toISOString();
  await db.insert(schema.gatewayPools).values({
    id: "pool-1",
    poolName: "default",
    status: "active",
    createdAt: now,
  });

  await db.insert(schema.bots).values({
    id: "bot-1",
    userId: "user-1",
    name: "Acme Bot",
    slug: "acme-bot",
    status: "active",
    modelId: "anthropic/claude-sonnet-4-6",
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
    channelConfig: "{}",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.channelCredentials).values([
    {
      id: "cred-1",
      botChannelId: "ch-1",
      credentialType: "botToken",
      encryptedValue: encrypt("xoxb-token"),
      createdAt: now,
    },
    {
      id: "cred-2",
      botChannelId: "ch-1",
      credentialType: "signingSecret",
      encryptedValue: encrypt("signing-secret"),
      createdAt: now,
    },
  ]);
}

describe("pool-config-service", () => {
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: TEST_DB_URL });
    db = drizzle(pool, { schema });
    await resetTables(pool);
  });

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE pool_config_snapshots, webhook_routes, channel_credentials, bot_channels, gateway_pools, bots CASCADE",
    );
    await seedPoolData();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("deduplicates unchanged config by hash", async () => {
    const first = await publishPoolConfigSnapshot(db, "pool-1");
    const second = await publishPoolConfigSnapshot(db, "pool-1");

    expect(first.version).toBe(1);
    expect(second.version).toBe(1);
    expect(second.configHash).toBe(first.configHash);
  });

  it("increments version when config changes", async () => {
    const first = await publishPoolConfigSnapshot(db, "pool-1");

    await db
      .update(schema.bots)
      .set({ name: "Acme Bot v2", updatedAt: new Date().toISOString() })
      .where(eq(schema.bots.id, "bot-1"));

    const second = await publishPoolConfigSnapshot(db, "pool-1");

    expect(second.version).toBe(first.version + 1);
    expect(second.configHash).not.toBe(first.configHash);
  });

  it("returns latest and specific version snapshots", async () => {
    const first = await publishPoolConfigSnapshot(db, "pool-1");

    await db
      .update(schema.bots)
      .set({ status: "paused", updatedAt: new Date().toISOString() })
      .where(eq(schema.bots.id, "bot-1"));

    const second = await publishPoolConfigSnapshot(db, "pool-1");

    const latest = await getLatestPoolConfigSnapshot(db, "pool-1");
    const byVersion = await getPoolConfigSnapshotByVersion(
      db,
      "pool-1",
      first.version,
    );

    expect(latest.version).toBe(second.version);
    expect(byVersion?.version).toBe(first.version);
  });
});
