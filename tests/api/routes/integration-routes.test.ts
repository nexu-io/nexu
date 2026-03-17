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
      redirectUrl: "https://connect.composio.dev/link/ln_mock123",
    }),
    checkOAuthStatus: vi.fn().mockResolvedValue({
      status: "ACTIVE",
      connectedAccountId: "ca_mock123",
    }),
    revokeConnection: vi.fn().mockResolvedValue(undefined),
  };
});

import {
  checkOAuthStatus,
  initializeOAuthConnection,
  revokeConnection,
} from "#api/lib/composio.js";
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
    CREATE UNIQUE INDEX bots_user_slug_idx ON bots (user_id, slug);

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
    CREATE UNIQUE INDEX pool_secrets_uniq_idx ON pool_secrets (pool_id, secret_name);

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
    CREATE UNIQUE INDEX user_integrations_user_toolkit_idx ON user_integrations (user_id, toolkit_slug);
    CREATE INDEX user_integrations_user_id_idx ON user_integrations (user_id);

    CREATE TABLE integration_credentials (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      integration_id TEXT NOT NULL,
      credential_key TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX int_cred_uniq_idx ON integration_credentials (integration_id, credential_key);
  `);
}

async function truncateAll(pool: pg.Pool) {
  await pool.query(
    "TRUNCATE integration_credentials, user_integrations, supported_toolkits, pool_secrets, bots CASCADE",
  );
}

function buildApp(defaultUserId = "user-1") {
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
  overrides: Partial<{
    id: string;
    slug: string;
    displayName: string;
    description: string;
    domain: string;
    authScheme: string;
    authFields: string;
    enabled: boolean;
    sortOrder: number;
  }> = {},
) {
  const t = {
    id: overrides.id ?? `tk-${Math.random().toString(36).slice(2, 8)}`,
    slug: overrides.slug ?? "notion",
    displayName: overrides.displayName ?? "Notion",
    description: overrides.description ?? "Knowledge base",
    domain: overrides.domain ?? "notion.so",
    authScheme: overrides.authScheme ?? "oauth2",
    authFields: overrides.authFields ?? null,
    enabled: overrides.enabled ?? true,
    sortOrder: overrides.sortOrder ?? 0,
  };
  const n = now();
  await pool.query(
    `INSERT INTO supported_toolkits (id, slug, display_name, description, domain, auth_scheme, auth_fields, enabled, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      t.id,
      t.slug,
      t.displayName,
      t.description,
      t.domain,
      t.authScheme,
      t.authFields,
      t.enabled,
      t.sortOrder,
      n,
      n,
    ],
  );
  return t;
}

async function seedIntegration(
  pool: pg.Pool,
  overrides: Partial<{
    id: string;
    userId: string;
    toolkitSlug: string;
    status: string;
    oauthState: string | null;
    composioAccountId: string | null;
    connectedAt: string | null;
  }> = {},
) {
  const i = {
    id: overrides.id ?? `int-${Math.random().toString(36).slice(2, 8)}`,
    userId: overrides.userId ?? "user-1",
    toolkitSlug: overrides.toolkitSlug ?? "notion",
    status: overrides.status ?? "pending",
    oauthState: overrides.oauthState ?? null,
    composioAccountId: overrides.composioAccountId ?? null,
    connectedAt: overrides.connectedAt ?? null,
  };
  const n = now();
  await pool.query(
    `INSERT INTO user_integrations (id, user_id, toolkit_slug, status, oauth_state, composio_account_id, connected_at, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      i.id,
      i.userId,
      i.toolkitSlug,
      i.status,
      i.oauthState,
      i.composioAccountId,
      i.connectedAt,
      n,
      n,
    ],
  );
  return i;
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
    userId: overrides.userId ?? "user-1",
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

describe("Integration Routes", () => {
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

  // ----------------------------------------------------------------
  // GET /api/v1/integrations
  // ----------------------------------------------------------------
  describe("GET /api/v1/integrations", () => {
    it("returns all enabled toolkits with pending status for new user", async () => {
      await seedToolkit(setupPool, { slug: "notion", sortOrder: 1 });
      await seedToolkit(setupPool, { slug: "googledrive", sortOrder: 2 });
      await seedToolkit(setupPool, { slug: "slack", sortOrder: 3 });

      const res = await app.request("/api/v1/integrations");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.integrations).toHaveLength(3);
      for (const i of body.integrations) {
        expect(i.status).toBe("pending");
      }
    });

    it("returns active for connected toolkit", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedIntegration(setupPool, {
        toolkitSlug: "notion",
        status: "active",
        connectedAt: now(),
      });

      const res = await app.request("/api/v1/integrations");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.integrations[0].status).toBe("active");
      expect(body.integrations[0].connectedAt).toBeTruthy();
    });

    it("excludes disabled toolkits", async () => {
      await seedToolkit(setupPool, { slug: "notion", enabled: true });
      await seedToolkit(setupPool, { slug: "hidden", enabled: false });

      const res = await app.request("/api/v1/integrations");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.integrations).toHaveLength(1);
      expect(body.integrations[0].toolkit.slug).toBe("notion");
    });

    it("returns active for api_key_global with stored credentials", async () => {
      await seedToolkit(setupPool, {
        slug: "openweather",
        authScheme: "api_key_global",
      });
      const n = now();
      await setupPool.query(
        `INSERT INTO integration_credentials (id, integration_id, credential_key, encrypted_value, created_at)
         VALUES ('cred-1', 'global:openweather', 'api_key', 'encrypted-value', $1)`,
        [n],
      );

      const res = await app.request("/api/v1/integrations");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.integrations[0].status).toBe("active");
    });

    it("user A cannot see user B integration status", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedIntegration(setupPool, {
        userId: "user-1",
        toolkitSlug: "notion",
        status: "active",
      });
      await seedIntegration(setupPool, {
        userId: "user-2",
        toolkitSlug: "notion",
        status: "initiated",
      });

      const res = await app.request("/api/v1/integrations", {
        headers: { "x-test-user-id": "user-2" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.integrations[0].status).toBe("initiated");
    });
  });

  // ----------------------------------------------------------------
  // POST /api/v1/integrations/connect
  // ----------------------------------------------------------------
  describe("POST /api/v1/integrations/connect", () => {
    it("oauth2 connect returns connectUrl and state", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool);

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkitSlug: "notion" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connectUrl).toBeTruthy();
      expect(body.state).toBeTruthy();
      expect(body.integration.status).toBe("initiated");
      expect(body.integration.id).toBeTruthy();

      // Verify DB row
      const { rows } = await setupPool.query(
        "SELECT status, oauth_state FROM user_integrations WHERE user_id = 'user-1' AND toolkit_slug = 'notion'",
      );
      expect(rows[0].status).toBe("initiated");
      expect(rows[0].oauth_state).toBe(body.state);
    });

    it("oauth2 connect updates existing pending row", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool);
      const existing = await seedIntegration(setupPool, {
        toolkitSlug: "notion",
        status: "pending",
      });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkitSlug: "notion" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.integration.id).toBe(existing.id);
      expect(body.integration.status).toBe("initiated");
    });

    it("api_key_user connect with valid credentials", async () => {
      await seedToolkit(setupPool, {
        slug: "shopify",
        authScheme: "api_key_user",
        authFields: JSON.stringify([
          { key: "shop_url", label: "Shop URL", type: "text" },
          { key: "api_key", label: "API Key", type: "secret" },
        ]),
      });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolkitSlug: "shopify",
          credentials: {
            shop_url: "my-store.myshopify.com",
            api_key: "shpat_xxxxx",
          },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.integration.status).toBe("active");
      expect(body.integration.connectedAt).toBeTruthy();

      // Verify credentials stored encrypted
      const { rows } = await setupPool.query(
        "SELECT credential_key, encrypted_value FROM integration_credentials WHERE integration_id = $1 ORDER BY credential_key",
        [body.integration.id],
      );
      expect(rows).toHaveLength(2);
      expect(rows[0].credential_key).toBe("api_key");
      expect(rows[0].encrypted_value).not.toBe("shpat_xxxxx");
      expect(rows[1].credential_key).toBe("shop_url");
    });

    it("api_key_user connect rejects missing required fields", async () => {
      await seedToolkit(setupPool, {
        slug: "shopify",
        authScheme: "api_key_user",
        authFields: JSON.stringify([
          { key: "shop_url", label: "Shop URL", type: "text" },
          { key: "api_key", label: "API Key", type: "secret" },
        ]),
      });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolkitSlug: "shopify",
          credentials: { shop_url: "my.shopify.com" },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("api_key_user connect rejects unknown fields", async () => {
      await seedToolkit(setupPool, {
        slug: "shopify",
        authScheme: "api_key_user",
        authFields: JSON.stringify([
          { key: "shop_url", label: "Shop URL", type: "text" },
          { key: "api_key", label: "API Key", type: "secret" },
        ]),
      });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolkitSlug: "shopify",
          credentials: {
            shop_url: "x",
            api_key: "y",
            extra: "bad",
          },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("api_key_user connect rejects empty values", async () => {
      await seedToolkit(setupPool, {
        slug: "shopify",
        authScheme: "api_key_user",
        authFields: JSON.stringify([
          { key: "shop_url", label: "Shop URL", type: "text" },
          { key: "api_key", label: "API Key", type: "secret" },
        ]),
      });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolkitSlug: "shopify",
          credentials: { shop_url: "", api_key: "shpat_xxx" },
        }),
      });

      expect(res.status).toBe(400);
    });

    it("cannot connect api_key_global toolkit", async () => {
      await seedToolkit(setupPool, {
        slug: "openweather",
        authScheme: "api_key_global",
      });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkitSlug: "openweather" }),
      });

      expect(res.status).toBe(400);
    });

    it("invalid toolkitSlug returns 404", async () => {
      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkitSlug: "nonexistent" }),
      });

      expect(res.status).toBe(404);
    });

    it("oauth2 connect with source chat and returnTo", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool);

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolkitSlug: "notion",
          source: "chat",
          returnTo: "/workspace/sessions/abc",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.connectUrl).toBeTruthy();
      expect(initializeOAuthConnection).toHaveBeenCalledWith(
        "test-composio-api-key",
        "notion",
        "user-1",
        expect.any(String),
        expect.any(String),
      );

      // Verify returnTo and source stored in DB
      const { rows } = await setupPool.query(
        "SELECT return_to, source FROM user_integrations WHERE user_id = 'user-1' AND toolkit_slug = 'notion'",
      );
      expect(rows[0].return_to).toBe("/workspace/sessions/abc");
      expect(rows[0].source).toBe("chat");
    });

    it("oauth2 connect rejects users without an active or paused bot", async () => {
      await seedToolkit(setupPool, { slug: "notion" });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkitSlug: "notion" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain("at least one bot assigned to a pool");
    });

    it("oauth2 connect succeeds for users with multiple bots (uses first pooled bot)", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool, {
        id: "bot-1",
        slug: "first-bot",
        poolId: "pool-1",
      });
      await seedBot(setupPool, {
        id: "bot-2",
        slug: "second-bot",
        poolId: "pool-2",
      });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkitSlug: "notion" }),
      });

      // Should not be rejected — multi-bot users are allowed
      expect(res.status).not.toBe(409);
    });

    it("oauth2 connect rejects users whose only bot has no pool assignment", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool, { poolId: null });

      const res = await app.request("/api/v1/integrations/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolkitSlug: "notion" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toContain("assigned to a pool");
    });
  });

  // ----------------------------------------------------------------
  // POST /api/v1/integrations/{integrationId}/refresh
  // ----------------------------------------------------------------
  describe("POST /api/v1/integrations/{integrationId}/refresh", () => {
    it("valid state + Composio ACTIVE sets status to active", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool);
      const integration = await seedIntegration(setupPool, {
        id: "int-refresh-1",
        toolkitSlug: "notion",
        status: "initiated",
        oauthState: "valid-state-123",
      });

      const res = await app.request(
        `/api/v1/integrations/${integration.id}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "valid-state-123" }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("active");
      expect(body.connectedAt).toBeTruthy();

      // Verify oauthState cleared
      const { rows } = await setupPool.query(
        "SELECT oauth_state, status FROM user_integrations WHERE id = $1",
        [integration.id],
      );
      expect(rows[0].oauth_state).toBeNull();
      expect(rows[0].status).toBe("active");
    });

    it("mismatched state returns 403", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool);
      const integration = await seedIntegration(setupPool, {
        id: "int-mismatch",
        toolkitSlug: "notion",
        status: "initiated",
        oauthState: "abc",
      });

      const res = await app.request(
        `/api/v1/integrations/${integration.id}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "xyz" }),
        },
      );

      expect(res.status).toBe(403);
    });

    it("already active integration returns 200 idempotently", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      const integration = await seedIntegration(setupPool, {
        id: "int-replay",
        toolkitSlug: "notion",
        status: "active",
        oauthState: null,
      });

      const res = await app.request(
        `/api/v1/integrations/${integration.id}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "anything" }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("active");
    });

    it("cross-user refresh returns 404", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      const integration = await seedIntegration(setupPool, {
        id: "int-cross-user",
        userId: "user-1",
        toolkitSlug: "notion",
        status: "initiated",
        oauthState: "state-123",
      });

      const res = await app.request(
        `/api/v1/integrations/${integration.id}/refresh`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-test-user-id": "user-2",
          },
          body: JSON.stringify({ state: "state-123" }),
        },
      );

      expect(res.status).toBe(404);
    });

    it("non-existent integrationId returns 404", async () => {
      const res = await app.request(
        "/api/v1/integrations/nonexistent/refresh",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "any" }),
        },
      );

      expect(res.status).toBe(404);
    });

    it("Composio returns non-ACTIVE keeps status as initiated", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool);
      const integration = await seedIntegration(setupPool, {
        id: "int-pending",
        toolkitSlug: "notion",
        status: "initiated",
        oauthState: "pending-state",
      });

      vi.mocked(checkOAuthStatus).mockResolvedValueOnce({
        status: "PENDING",
      });

      const res = await app.request(
        `/api/v1/integrations/${integration.id}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "pending-state" }),
        },
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("initiated");

      // oauthState should NOT be cleared
      const { rows } = await setupPool.query(
        "SELECT oauth_state FROM user_integrations WHERE id = $1",
        [integration.id],
      );
      expect(rows[0].oauth_state).toBe("pending-state");
    });

    it("refresh succeeds for users with multiple bots (uses first pooled bot)", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      await seedBot(setupPool, {
        id: "bot-1",
        slug: "first-bot",
        poolId: "pool-1",
      });
      await seedBot(setupPool, {
        id: "bot-2",
        slug: "second-bot",
        poolId: "pool-2",
      });
      const integration = await seedIntegration(setupPool, {
        id: "int-multi-bot",
        toolkitSlug: "notion",
        status: "initiated",
        oauthState: "multi-bot-state",
      });

      const res = await app.request(
        `/api/v1/integrations/${integration.id}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "multi-bot-state" }),
        },
      );

      // Should not be rejected — multi-bot users are allowed
      expect(res.status).not.toBe(409);
    });

    it("refresh on active api_key_user integration returns 200 idempotently", async () => {
      await seedToolkit(setupPool, {
        slug: "shopify",
        authScheme: "api_key_user",
        authFields: JSON.stringify([
          { key: "api_key", label: "API Key", type: "secret" },
        ]),
      });
      const integration = await seedIntegration(setupPool, {
        id: "int-apikey",
        toolkitSlug: "shopify",
        status: "active",
        oauthState: "some-state",
      });

      const res = await app.request(
        `/api/v1/integrations/${integration.id}/refresh`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: "some-state" }),
        },
      );

      // Active integration returns 200 idempotently regardless of auth scheme
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("active");
    });
  });

  // ----------------------------------------------------------------
  // DELETE /api/v1/integrations/{integrationId}
  // ----------------------------------------------------------------
  describe("DELETE /api/v1/integrations/{integrationId}", () => {
    it("disconnect oauth2 integration", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      const integration = await seedIntegration(setupPool, {
        id: "int-del-oauth",
        toolkitSlug: "notion",
        status: "active",
        composioAccountId: "ca_abc123",
      });

      const res = await app.request(`/api/v1/integrations/${integration.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("disconnected");
      expect(body.disconnectedAt).toBeTruthy();
      expect(revokeConnection).toHaveBeenCalledWith("ca_abc123");
    });

    it("disconnect api_key_user deletes credentials", async () => {
      await seedToolkit(setupPool, {
        slug: "shopify",
        authScheme: "api_key_user",
        authFields: JSON.stringify([
          { key: "api_key", label: "API Key", type: "secret" },
        ]),
      });
      const integration = await seedIntegration(setupPool, {
        id: "int-del-apikey",
        toolkitSlug: "shopify",
        status: "active",
      });
      const n = now();
      await setupPool.query(
        `INSERT INTO integration_credentials (id, integration_id, credential_key, encrypted_value, created_at)
         VALUES ('cred-del-1', $1, 'api_key', 'encrypted', $2)`,
        [integration.id, n],
      );

      const res = await app.request(`/api/v1/integrations/${integration.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("disconnected");

      // Credentials deleted
      const { rows } = await setupPool.query(
        "SELECT * FROM integration_credentials WHERE integration_id = $1",
        [integration.id],
      );
      expect(rows).toHaveLength(0);
    });

    it("cannot disconnect api_key_global returns 403", async () => {
      await seedToolkit(setupPool, {
        slug: "openweather",
        authScheme: "api_key_global",
      });
      const integration = await seedIntegration(setupPool, {
        id: "int-del-global",
        toolkitSlug: "openweather",
        status: "active",
      });

      const res = await app.request(`/api/v1/integrations/${integration.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(403);
    });

    it("cross-user delete returns 404", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      const integration = await seedIntegration(setupPool, {
        id: "int-cross-del",
        userId: "user-1",
        toolkitSlug: "notion",
        status: "active",
      });

      const res = await app.request(`/api/v1/integrations/${integration.id}`, {
        method: "DELETE",
        headers: { "x-test-user-id": "user-2" },
      });

      expect(res.status).toBe(404);
    });

    it("non-existent integrationId returns 404", async () => {
      const res = await app.request("/api/v1/integrations/nonexistent", {
        method: "DELETE",
      });

      expect(res.status).toBe(404);
    });

    it("already disconnected is idempotent 200", async () => {
      await seedToolkit(setupPool, { slug: "notion" });
      const integration = await seedIntegration(setupPool, {
        id: "int-already-disc",
        toolkitSlug: "notion",
        status: "disconnected",
      });

      const res = await app.request(`/api/v1/integrations/${integration.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("disconnected");
    });
  });
});
