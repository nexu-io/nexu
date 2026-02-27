import pg from "pg";

export async function migrate(dbUrl?: string) {
  const databaseUrl =
    dbUrl ??
    process.env.DATABASE_URL ??
    "postgresql://nexu:nexu@localhost:5433/nexu_dev";

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  // better-auth core tables
  await client.query(`
    CREATE TABLE IF NOT EXISTS "user" (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE,
      image TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS session (
      id TEXT PRIMARY KEY,
      "expiresAt" TIMESTAMP NOT NULL,
      token TEXT NOT NULL UNIQUE,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "ipAddress" TEXT,
      "userAgent" TEXT,
      "userId" TEXT NOT NULL REFERENCES "user"(id)
    );

    CREATE TABLE IF NOT EXISTS account (
      id TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "userId" TEXT NOT NULL REFERENCES "user"(id),
      "accessToken" TEXT,
      "refreshToken" TEXT,
      "idToken" TEXT,
      "accessTokenExpiresAt" TIMESTAMP,
      "refreshTokenExpiresAt" TIMESTAMP,
      scope TEXT,
      password TEXT,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS verification (
      id TEXT PRIMARY KEY,
      identifier TEXT NOT NULL,
      value TEXT NOT NULL,
      "expiresAt" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Application tables
  await client.query(`
    CREATE TABLE IF NOT EXISTS bots (
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
    CREATE UNIQUE INDEX IF NOT EXISTS bots_user_slug_idx ON bots(user_id, slug);

    CREATE TABLE IF NOT EXISTS bot_channels (
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
    CREATE UNIQUE INDEX IF NOT EXISTS bot_channels_uniq_idx ON bot_channels(bot_id, channel_type, account_id);

    CREATE TABLE IF NOT EXISTS channel_credentials (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_channel_id TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS cred_uniq_idx ON channel_credentials(bot_channel_id, credential_type);

    CREATE TABLE IF NOT EXISTS gateway_pools (
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

    CREATE TABLE IF NOT EXISTS users (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      auth_user_id TEXT NOT NULL UNIQUE,
      plan TEXT DEFAULT 'free',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usage_metrics (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL,
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      message_count INTEGER DEFAULT 0,
      token_count INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gateway_assignments (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_routes (
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
    CREATE UNIQUE INDEX IF NOT EXISTS webhook_routes_uniq_idx ON webhook_routes(channel_type, external_id);

    CREATE TABLE IF NOT EXISTS pool_config_snapshots (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      config_hash TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pool_config_snapshots_pool_version_idx ON pool_config_snapshots(pool_id, version);
    CREATE UNIQUE INDEX IF NOT EXISTS pool_config_snapshots_pool_hash_idx ON pool_config_snapshots(pool_id, config_hash);

    CREATE TABLE IF NOT EXISTS oauth_states (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL UNIQUE,
      bot_id TEXT,
      user_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      max_uses INTEGER DEFAULT 100,
      used_count INTEGER DEFAULT 0,
      created_by TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL,
      session_key TEXT,
      channel_type TEXT,
      channel_id TEXT,
      title TEXT NOT NULL,
      artifact_type TEXT,
      source TEXT,
      content_type TEXT,
      status TEXT DEFAULT 'building',
      preview_url TEXT,
      deploy_target TEXT,
      lines_of_code INTEGER,
      file_count INTEGER,
      duration_ms INTEGER,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS artifacts_bot_id_idx ON artifacts(bot_id);
    CREATE INDEX IF NOT EXISTS artifacts_session_key_idx ON artifacts(session_key);
    CREATE INDEX IF NOT EXISTS artifacts_status_idx ON artifacts(status);
    CREATE INDEX IF NOT EXISTS artifacts_created_at_idx ON artifacts(created_at);

    CREATE TABLE IF NOT EXISTS sessions (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      bot_id TEXT NOT NULL,
      session_key TEXT NOT NULL UNIQUE,
      channel_type TEXT,
      channel_id TEXT,
      title TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      message_count INTEGER DEFAULT 0,
      last_message_at TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_bot_id_idx ON sessions(bot_id);
    CREATE INDEX IF NOT EXISTS sessions_status_idx ON sessions(status);
    CREATE INDEX IF NOT EXISTS sessions_created_at_idx ON sessions(created_at);
    CREATE INDEX IF NOT EXISTS sessions_channel_type_idx ON sessions(channel_type);
  `);

  // Migrations
  await client.query(`
    ALTER TABLE oauth_states ALTER COLUMN bot_id DROP NOT NULL;
  `);

  await client.query(`
    ALTER TABLE gateway_pools ADD COLUMN IF NOT EXISTS last_seen_version INTEGER DEFAULT 0;
    ALTER TABLE webhook_routes ADD COLUMN IF NOT EXISTS bot_id TEXT;
    ALTER TABLE webhook_routes ADD COLUMN IF NOT EXISTS account_id TEXT;
    ALTER TABLE webhook_routes ADD COLUMN IF NOT EXISTS runtime_url TEXT;
    ALTER TABLE webhook_routes ADD COLUMN IF NOT EXISTS updated_at TEXT DEFAULT NOW()::TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_accepted_at TEXT;
  `);

  // Recreate webhook_routes unique index to handle composite external_id (teamId:appId)
  await client.query(`
    DROP INDEX IF EXISTS webhook_routes_uniq_idx;
    CREATE UNIQUE INDEX IF NOT EXISTS webhook_routes_uniq_idx ON webhook_routes(channel_type, external_id);
  `);

  console.log("Database migrated successfully");
  await client.end();
}
