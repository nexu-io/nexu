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

vi.mock("#api/lib/composio.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    initializeOAuthConnection: vi.fn().mockResolvedValue({
      redirectUrl: "https://connect.composio.dev/link/ln_e2e_mock",
    }),
    checkOAuthStatus: vi.fn().mockResolvedValue({
      status: "ACTIVE",
      connectedAccountId: "ca_e2e_mock",
    }),
    revokeConnection: vi.fn().mockResolvedValue(undefined),
  };
});

import { revokeConnection } from "#api/lib/composio.js";
import { decrypt } from "#api/lib/crypto.js";
import { registerIntegrationRoutes } from "#api/routes/integration-routes.js";
import type { AppBindings } from "#api/types.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

let setupPool: pg.Pool;

async function createTables(pool: pg.Pool) {
  await pool.query(`
    DROP TABLE IF EXISTS pool_secrets CASCADE;
    DROP TABLE IF EXISTS bots CASCADE;
    DROP TABLE IF EXISTS integration_credentials CASCADE;
    DROP TABLE IF EXISTS user_integrations CASCADE;
    DROP TABLE IF EXISTS supported_toolkits CASCADE;

    CREATE TABLE bots (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      pool_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS bots_user_slug_idx ON bots (user_id, slug);

    CREATE TABLE pool_secrets (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      pool_id TEXT NOT NULL,
      secret_name TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT 'pool',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS pool_secrets_uniq_idx ON pool_secrets (pool_id, secret_name);

    CREATE TABLE supported_toolkits (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      domain TEXT NOT NULL,
      category TEXT DEFAULT 'office',
      auth_scheme TEXT NOT NULL DEFAULT 'oauth2',
      auth_fields TEXT,
      enabled BOOLEAN DEFAULT true,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE user_integrations (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL,
      toolkit_slug TEXT NOT NULL,
      composio_account_id TEXT,
      status TEXT DEFAULT 'pending',
      oauth_state TEXT,
      return_to TEXT,
      source TEXT,
      connected_at TEXT,
      disconnected_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS user_integrations_user_toolkit_idx ON user_integrations (user_id, toolkit_slug);
    CREATE INDEX IF NOT EXISTS user_integrations_user_id_idx ON user_integrations (user_id);

    CREATE TABLE integration_credentials (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      integration_id TEXT NOT NULL,
      credential_key TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS int_cred_uniq_idx ON integration_credentials (integration_id, credential_key);
  `);
}

async function truncateAll(pool: pg.Pool) {
  await pool.query(
    "TRUNCATE integration_credentials, user_integrations, supported_toolkits, pool_secrets, bots CASCADE",
  );
}

function buildApp(defaultUserId = "e2e-user-1") {
  const app = new OpenAPIHono<AppBindings>();
  app.use("*", async (c, next) => {
    c.set("userId", c.req.header("x-test-user-id") ?? defaultUserId);
    await next();
  });
  registerIntegrationRoutes(app);
  return app;
}

const now = () => new Date().toISOString();

async function seedToolkit(
  pool: pg.Pool,
  slug: string,
  overrides: Partial<{
    authScheme: string;
    authFields: string;
    enabled: boolean;
  }> = {},
) {
  const n = now();
  const id = `tk-e2e-${slug}`;
  await pool.query(
    `INSERT INTO supported_toolkits (id, slug, display_name, description, domain, auth_scheme, auth_fields, enabled, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $10)`,
    [
      id,
      slug,
      slug.charAt(0).toUpperCase() + slug.slice(1),
      `${slug} integration`,
      `${slug}.com`,
      overrides.authScheme ?? "oauth2",
      overrides.authFields ?? null,
      overrides.enabled ?? true,
      n,
      n,
    ],
  );
  return id;
}

async function seedBot(
  pool: pg.Pool,
  overrides: Partial<{
    id: string;
    userId: string;
    name: string;
    slug: string;
    status: string;
    poolId: string | null;
  }> = {},
) {
  const bot = {
    id: overrides.id ?? `bot-${Math.random().toString(36).slice(2, 8)}`,
    userId: overrides.userId ?? "e2e-user-1",
    name: overrides.name ?? "My Bot",
    slug: overrides.slug ?? `bot-${Math.random().toString(36).slice(2, 6)}`,
    status: overrides.status ?? "active",
    poolId:
      overrides.poolId !== undefined
        ? overrides.poolId
        : ("pool-1" as string | null),
  };
  const n = now();
  await pool.query(
    `INSERT INTO bots (id, user_id, name, slug, status, pool_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [bot.id, bot.userId, bot.name, bot.slug, bot.status, bot.poolId, n, n],
  );
  return bot;
}

describe("E2E: OAuth2 integration flow", () => {
  const app = buildApp();

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.COMPOSIO_API_KEY = "test-composio-api-key";
    setupPool = new pg.Pool({ connectionString: TEST_DB_URL });
    await createTables(setupPool);
  });

  afterAll(async () => {
    await setupPool.end();
  });

  beforeEach(async () => {
    await truncateAll(setupPool);
    vi.clearAllMocks();
  });

  it("connect → refresh → list → disconnect lifecycle", async () => {
    await seedToolkit(setupPool, "notion");
    await seedBot(setupPool);

    // 1. GET — toolkit exists, status pending
    const listRes1 = await app.request("/api/v1/integrations");
    expect(listRes1.status).toBe(200);
    const list1 = await listRes1.json();
    expect(list1.integrations).toHaveLength(1);
    expect(list1.integrations[0].status).toBe("pending");
    expect(list1.integrations[0].toolkit.slug).toBe("notion");

    // 2. POST connect — returns connectUrl + state
    const connectRes = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitSlug: "notion", source: "page" }),
    });
    expect(connectRes.status).toBe(200);
    const connectBody = await connectRes.json();
    expect(connectBody.connectUrl).toBeTruthy();
    expect(connectBody.state).toBeTruthy();
    expect(connectBody.integration.status).toBe("initiated");
    const integrationId = connectBody.integration.id;

    // Verify DB row
    const { rows: dbRows1 } = await setupPool.query(
      "SELECT status, oauth_state FROM user_integrations WHERE id = $1",
      [integrationId],
    );
    expect(dbRows1[0].status).toBe("initiated");
    expect(dbRows1[0].oauth_state).toBe(connectBody.state);

    // 3. POST refresh with correct state — Composio returns ACTIVE
    const refreshRes = await app.request(
      `/api/v1/integrations/${integrationId}/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: connectBody.state }),
      },
    );
    expect(refreshRes.status).toBe(200);
    const refreshBody = await refreshRes.json();
    expect(refreshBody.status).toBe("active");
    expect(refreshBody.connectedAt).toBeTruthy();

    // Verify oauthState cleared
    const { rows: dbRows2 } = await setupPool.query(
      "SELECT oauth_state, status, composio_account_id FROM user_integrations WHERE id = $1",
      [integrationId],
    );
    expect(dbRows2[0].oauth_state).toBeNull();
    expect(dbRows2[0].status).toBe("active");
    expect(dbRows2[0].composio_account_id).toBe("ca_e2e_mock");

    // 4. GET — toolkit shows active
    const listRes2 = await app.request("/api/v1/integrations");
    const list2 = await listRes2.json();
    expect(list2.integrations[0].status).toBe("active");

    // 5. DELETE — disconnect
    const deleteRes = await app.request(
      `/api/v1/integrations/${integrationId}`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json();
    expect(deleteBody.status).toBe("disconnected");
    expect(revokeConnection).toHaveBeenCalledWith("ca_e2e_mock");

    // 6. GET — toolkit shows disconnected
    const listRes3 = await app.request("/api/v1/integrations");
    const list3 = await listRes3.json();
    expect(list3.integrations[0].status).toBe("disconnected");
  });
});

describe("E2E: api_key_user integration flow", () => {
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
    await truncateAll(setupPool);
    vi.clearAllMocks();
  });

  it("connect with credentials → verify encryption → list with hints → disconnect deletes credentials", async () => {
    await seedToolkit(setupPool, "shopify", {
      authScheme: "api_key_user",
      authFields: JSON.stringify([
        {
          key: "shop_url",
          label: "Shop URL",
          type: "text",
          placeholder: "my-store.myshopify.com",
        },
        { key: "api_key", label: "API Key", type: "secret" },
      ]),
    });

    // 1. Connect with credentials
    const connectRes = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolkitSlug: "shopify",
        credentials: {
          shop_url: "test-store.myshopify.com",
          api_key: "shpat_abcdef123456",
        },
      }),
    });
    expect(connectRes.status).toBe(200);
    const connectBody = await connectRes.json();
    expect(connectBody.integration.status).toBe("active");
    const integrationId = connectBody.integration.id;

    // 2. Verify encryption in DB
    const { rows: credRows } = await setupPool.query(
      "SELECT credential_key, encrypted_value FROM integration_credentials WHERE integration_id = $1 ORDER BY credential_key",
      [integrationId],
    );
    expect(credRows).toHaveLength(2);

    // Verify encrypted values are NOT plaintext
    expect(credRows[0].encrypted_value).not.toBe("shpat_abcdef123456");
    expect(credRows[1].encrypted_value).not.toBe("test-store.myshopify.com");

    // Verify decrypt round-trip works
    const decryptedApiKey = decrypt(credRows[0].encrypted_value);
    expect(decryptedApiKey).toBe("shpat_abcdef123456");
    const decryptedShopUrl = decrypt(credRows[1].encrypted_value);
    expect(decryptedShopUrl).toBe("test-store.myshopify.com");

    // 3. GET list — verify credentialHints present, masked
    const listRes = await app.request("/api/v1/integrations");
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json();
    const integration = listBody.integrations[0];
    expect(integration.status).toBe("active");
    expect(integration.credentialHints).toBeDefined();
    expect(integration.credentialHints.api_key).toBe("shpa..3456");
    expect(integration.credentialHints.shop_url).toBe("test...com");

    // Verify response does NOT contain raw values
    const rawJson = JSON.stringify(listBody);
    expect(rawJson).not.toContain("shpat_abcdef123456");
    expect(rawJson).not.toContain("test-store.myshopify.com");
    expect(rawJson).not.toContain("encryptedValue");

    // 4. DELETE — credentials deleted from DB
    const deleteRes = await app.request(
      `/api/v1/integrations/${integrationId}`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(200);
    expect((await deleteRes.json()).status).toBe("disconnected");

    const { rows: afterCreds } = await setupPool.query(
      "SELECT * FROM integration_credentials WHERE integration_id = $1",
      [integrationId],
    );
    expect(afterCreds).toHaveLength(0);

    const { rows: afterInt } = await setupPool.query(
      "SELECT status FROM user_integrations WHERE id = $1",
      [integrationId],
    );
    expect(afterInt[0].status).toBe("disconnected");
  });
});

describe("E2E: Security enforcement", () => {
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
    await truncateAll(setupPool);
    vi.clearAllMocks();
  });

  it("user-2 cannot refresh user-1's integration", async () => {
    await seedToolkit(setupPool, "notion");
    await seedBot(setupPool, { userId: "e2e-user-1" });
    // Connect as user-1
    const connectRes = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": "e2e-user-1",
      },
      body: JSON.stringify({ toolkitSlug: "notion" }),
    });
    const { integration, state } = await connectRes.json();

    // Try refresh as user-2
    const refreshRes = await app.request(
      `/api/v1/integrations/${integration.id}/refresh`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": "e2e-user-2",
        },
        body: JSON.stringify({ state }),
      },
    );
    expect(refreshRes.status).toBe(404);

    // Verify unchanged
    const { rows } = await setupPool.query(
      "SELECT status FROM user_integrations WHERE id = $1",
      [integration.id],
    );
    expect(rows[0].status).toBe("initiated");
  });

  it("user-2 cannot delete user-1's integration", async () => {
    await seedToolkit(setupPool, "notion");
    await seedBot(setupPool, { userId: "e2e-user-1" });
    const connectRes = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": "e2e-user-1",
      },
      body: JSON.stringify({ toolkitSlug: "notion" }),
    });
    const { integration, state } = await connectRes.json();

    // Refresh as user-1 to make it active
    await app.request(`/api/v1/integrations/${integration.id}/refresh`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user-id": "e2e-user-1",
      },
      body: JSON.stringify({ state }),
    });

    // Try delete as user-2
    const deleteRes = await app.request(
      `/api/v1/integrations/${integration.id}`,
      {
        method: "DELETE",
        headers: { "x-test-user-id": "e2e-user-2" },
      },
    );
    expect(deleteRes.status).toBe(404);

    // Verify still active
    const { rows } = await setupPool.query(
      "SELECT status FROM user_integrations WHERE id = $1",
      [integration.id],
    );
    expect(rows[0].status).toBe("active");
  });

  it("refresh with wrong state token returns 403", async () => {
    await seedToolkit(setupPool, "notion");
    await seedBot(setupPool);
    const connectRes = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitSlug: "notion" }),
    });
    const { integration } = await connectRes.json();

    const refreshRes = await app.request(
      `/api/v1/integrations/${integration.id}/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: "wrong-state-token" }),
      },
    );
    expect(refreshRes.status).toBe(403);

    // State NOT cleared
    const { rows } = await setupPool.query(
      "SELECT oauth_state, status FROM user_integrations WHERE id = $1",
      [integration.id],
    );
    expect(rows[0].oauth_state).not.toBeNull();
    expect(rows[0].status).toBe("initiated");
  });

  it("refresh with already-used state returns 200 idempotently", async () => {
    await seedToolkit(setupPool, "notion");
    await seedBot(setupPool);
    const connectRes = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitSlug: "notion" }),
    });
    const { integration, state } = await connectRes.json();

    // First refresh succeeds
    const refresh1 = await app.request(
      `/api/v1/integrations/${integration.id}/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      },
    );
    expect(refresh1.status).toBe(200);
    const body1 = await refresh1.json();
    expect(body1.status).toBe("active");

    // Second refresh with same state returns 200 idempotently (integration is now active)
    const refresh2 = await app.request(
      `/api/v1/integrations/${integration.id}/refresh`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      },
    );
    expect(refresh2.status).toBe(200);
    const body2 = await refresh2.json();
    expect(body2.status).toBe("active");
  });

  it("cannot disconnect api_key_global toolkit", async () => {
    await seedToolkit(setupPool, "openweather", {
      authScheme: "api_key_global",
    });
    const n = now();
    // Insert global credentials
    await setupPool.query(
      `INSERT INTO integration_credentials (id, integration_id, credential_key, encrypted_value, created_at)
       VALUES ('gc-1', 'global:openweather', 'api_key', 'encrypted', $1)`,
      [n],
    );
    // Insert user integration row
    await setupPool.query(
      `INSERT INTO user_integrations (id, user_id, toolkit_slug, status, created_at, updated_at)
       VALUES ('int-global', 'e2e-user-1', 'openweather', 'active', $1, $2)`,
      [n, n],
    );

    const deleteRes = await app.request("/api/v1/integrations/int-global", {
      method: "DELETE",
    });
    expect(deleteRes.status).toBe(403);

    // Credentials still in DB
    const { rows } = await setupPool.query(
      "SELECT * FROM integration_credentials WHERE integration_id = 'global:openweather'",
    );
    expect(rows).toHaveLength(1);
  });

  it("credentials never appear in GET response", async () => {
    await seedToolkit(setupPool, "shopify", {
      authScheme: "api_key_user",
      authFields: JSON.stringify([
        { key: "api_key", label: "API Key", type: "secret" },
      ]),
    });

    await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        toolkitSlug: "shopify",
        credentials: { api_key: "super_secret_key_12345" },
      }),
    });

    const listRes = await app.request("/api/v1/integrations");
    const rawJson = JSON.stringify(await listRes.json());

    expect(rawJson).not.toContain("super_secret_key_12345");
    expect(rawJson).not.toContain("encrypted_value");
    expect(rawJson).not.toContain("encryptedValue");
  });
});

describe("E2E: api_key_global toolkit", () => {
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
    await truncateAll(setupPool);
    vi.clearAllMocks();
  });

  it("shows active when global credentials exist", async () => {
    await seedToolkit(setupPool, "openweather", {
      authScheme: "api_key_global",
    });
    const n = now();
    await setupPool.query(
      `INSERT INTO integration_credentials (id, integration_id, credential_key, encrypted_value, created_at)
       VALUES ('gc-active', 'global:openweather', 'api_key', 'encrypted', $1)`,
      [n],
    );

    const res = await app.request("/api/v1/integrations");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.integrations[0].status).toBe("active");
  });

  it("shows pending when no global credentials exist", async () => {
    await seedToolkit(setupPool, "openweather", {
      authScheme: "api_key_global",
    });

    const res = await app.request("/api/v1/integrations");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.integrations[0].status).toBe("pending");
  });
});

describe("E2E: Edge cases", () => {
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
    await truncateAll(setupPool);
    vi.clearAllMocks();
  });

  it("re-connect after disconnect creates new integration flow", async () => {
    await seedToolkit(setupPool, "notion");
    await seedBot(setupPool);

    // Connect → refresh → active
    const connect1 = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitSlug: "notion" }),
    });
    const c1 = await connect1.json();
    await app.request(`/api/v1/integrations/${c1.integration.id}/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: c1.state }),
    });

    // Disconnect
    await app.request(`/api/v1/integrations/${c1.integration.id}`, {
      method: "DELETE",
    });

    // Re-connect
    const connect2 = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitSlug: "notion" }),
    });
    const c2 = await connect2.json();
    expect(c2.integration.id).toBe(c1.integration.id); // same row reused
    expect(c2.integration.status).toBe("initiated");
    expect(c2.state).not.toBe(c1.state); // new state

    // Verify DB: composioAccountId cleared, new oauthState
    const { rows } = await setupPool.query(
      "SELECT composio_account_id, oauth_state FROM user_integrations WHERE id = $1",
      [c1.integration.id],
    );
    expect(rows[0].composio_account_id).toBeNull();
    expect(rows[0].oauth_state).toBe(c2.state);
  });

  it("connect same toolkit twice returns same integration", async () => {
    await seedToolkit(setupPool, "notion");
    await seedBot(setupPool);

    const connect1 = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitSlug: "notion" }),
    });
    const c1 = await connect1.json();

    const connect2 = await app.request("/api/v1/integrations/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolkitSlug: "notion" }),
    });
    const c2 = await connect2.json();

    expect(c2.integration.id).toBe(c1.integration.id);
    expect(c2.state).not.toBe(c1.state); // regenerated
  });

  it("list synthesizes pending for toolkits without user rows", async () => {
    await seedToolkit(setupPool, "notion");
    await seedToolkit(setupPool, "googledrive");
    await seedToolkit(setupPool, "slack");

    // Only create integration for notion
    const n = now();
    await setupPool.query(
      `INSERT INTO user_integrations (id, user_id, toolkit_slug, status, connected_at, created_at, updated_at)
       VALUES ('int-notion', 'e2e-user-1', 'notion', 'active', $1, $2, $3)`,
      [n, n, n],
    );

    const res = await app.request("/api/v1/integrations");
    const body = await res.json();
    expect(body.integrations).toHaveLength(3);

    const statuses = body.integrations.map(
      (i: { toolkit: { slug: string }; status: string }) => ({
        slug: i.toolkit.slug,
        status: i.status,
      }),
    );
    expect(statuses).toContainEqual({ slug: "notion", status: "active" });
    expect(statuses).toContainEqual({ slug: "googledrive", status: "pending" });
    expect(statuses).toContainEqual({ slug: "slack", status: "pending" });

    // Pending items have no id (synthesized)
    const pendingItems = body.integrations.filter(
      (i: { status: string }) => i.status === "pending",
    );
    for (const p of pendingItems) {
      expect(p.id).toBeUndefined();
    }
  });

  it("disabled toolkit not returned even if user has integration row", async () => {
    await seedToolkit(setupPool, "notion", { enabled: false });
    const n = now();
    await setupPool.query(
      `INSERT INTO user_integrations (id, user_id, toolkit_slug, status, created_at, updated_at)
       VALUES ('int-disabled', 'e2e-user-1', 'notion', 'active', $1, $2)`,
      [n, n],
    );

    const res = await app.request("/api/v1/integrations");
    const body = await res.json();
    expect(body.integrations).toHaveLength(0);
  });
});
