import { OpenAPIHono } from "@hono/zod-openapi";
import pg from "pg";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("#api/db/index.js", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { default: PgPool } = await import("pg");
  const schemaModule = await import("#api/db/schema/index.js");
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://nexu:nexu@localhost:5433/nexu_test";
  const pool = new PgPool.Pool({ connectionString: url });
  return {
    db: drizzle(pool, { schema: schemaModule }),
    pool,
  };
});

const { getFeishuTenantTokenMock } = vi.hoisted(() => ({
  getFeishuTenantTokenMock: vi.fn(),
}));
vi.mock("#api/lib/feishu-webhook.js", () => ({
  getFeishuTenantToken: getFeishuTenantTokenMock,
}));

vi.mock("#api/services/runtime/pool-config-service.js", () => ({
  publishPoolConfigSnapshot: vi.fn().mockResolvedValue(undefined),
}));

import { registerChannelRoutes } from "#api/routes/channel-routes.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

let setupPool: pg.Pool;

async function createTables(pool: pg.Pool) {
  await pool.query(`
    DROP TABLE IF EXISTS oauth_states CASCADE;
    DROP TABLE IF EXISTS webhook_routes CASCADE;
    DROP TABLE IF EXISTS channel_credentials CASCADE;
    DROP TABLE IF EXISTS bot_channels CASCADE;
    DROP TABLE IF EXISTS gateway_assignments CASCADE;
    DROP TABLE IF EXISTS bots CASCADE;
    DROP TABLE IF EXISTS gateway_pools CASCADE;

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

    CREATE TABLE bots (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      system_prompt TEXT,
      model_id TEXT DEFAULT 'anthropic/claude-sonnet-4',
      agent_config TEXT DEFAULT '{}',
      tools_config TEXT DEFAULT '{}',
      status TEXT DEFAULT 'active',
      pool_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE gateway_assignments (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL
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

    CREATE TABLE oauth_states (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL UNIQUE,
      bot_id TEXT,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      return_to TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

async function truncateAll(pool: pg.Pool) {
  await pool.query(
    "TRUNCATE oauth_states, webhook_routes, channel_credentials, bot_channels, gateway_assignments, bots, gateway_pools CASCADE",
  );
}

function buildApp() {
  const app = new OpenAPIHono();
  app.use("*", async (c, next) => {
    c.set("userId", "user-1");
    await next();
  });
  registerChannelRoutes(app as Parameters<typeof registerChannelRoutes>[0]);
  return app;
}

describe("Channel Routes", () => {
  const app = buildApp();

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    setupPool = new pg.Pool({ connectionString: TEST_DB_URL });
    await createTables(setupPool);
  });

  afterAll(async () => {
    await setupPool.end();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    getFeishuTenantTokenMock.mockResolvedValue("tenant-token");
    await truncateAll(setupPool);

    const now = new Date().toISOString();
    await setupPool.query(
      `INSERT INTO gateway_pools (id, pool_name, status, pod_ip, created_at)
       VALUES ('pool-1', 'pool-1', 'active', '127.0.0.1', $1)`,
      [now],
    );
  });

  it("creates Feishu channel credentials on first connect", async () => {
    const res = await app.request("/api/v1/channels/feishu/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: "cli_test_app",
        appSecret: "secret-1",
      }),
    });

    expect(res.status).toBe(200);

    const creds = await setupPool.query(
      `SELECT credential_type
       FROM channel_credentials
       ORDER BY credential_type ASC`,
    );
    expect(creds.rows.map((row) => row.credential_type)).toEqual([
      "appId",
      "appSecret",
    ]);
  });

  it("heals an existing Feishu channel that is missing credentials", async () => {
    const now = new Date().toISOString();
    await setupPool.query(
      `INSERT INTO bots (id, user_id, name, slug, status, pool_id, created_at, updated_at)
       VALUES ('bot-1', 'user-1', 'My Bot', 'my-bot', 'active', 'pool-1', $1, $2)`,
      [now, now],
    );
    await setupPool.query(
      `INSERT INTO gateway_assignments (id, bot_id, pool_id, assigned_at)
       VALUES ('ga-1', 'bot-1', 'pool-1', $1)`,
      [now],
    );
    await setupPool.query(
      `INSERT INTO bot_channels (id, bot_id, channel_type, account_id, status, channel_config, created_at, updated_at)
       VALUES ('ch-1', 'bot-1', 'feishu', 'feishu-cli_test_app', 'connected', '{"appId":"cli_test_app"}', $1, $2)`,
      [now, now],
    );

    const res = await app.request("/api/v1/channels/feishu/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appId: "cli_test_app",
        appSecret: "secret-2",
      }),
    });

    expect(res.status).toBe(200);

    const channels = await setupPool.query(
      "SELECT id, account_id, status FROM bot_channels",
    );
    expect(channels.rows).toHaveLength(1);
    expect(channels.rows[0]?.id).toBe("ch-1");
    expect(channels.rows[0]?.status).toBe("connected");

    const creds = await setupPool.query(
      `SELECT credential_type
       FROM channel_credentials
       WHERE bot_channel_id = 'ch-1'
       ORDER BY credential_type ASC`,
    );
    expect(creds.rows.map((row) => row.credential_type)).toEqual([
      "appId",
      "appSecret",
    ]);
  });
});
