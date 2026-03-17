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
    executeAction: vi.fn().mockResolvedValue({
      data: { messages: [{ id: "msg1", subject: "Hello" }] },
      error: null,
      successful: true,
    }),
  };
});

import { executeAction } from "#api/lib/composio.js";
import { registerComposioRoutes } from "#api/routes/composio-routes.js";

import type { AppBindings } from "#api/types.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

const SKILL_TOKEN = "test-skill-token-abc";
let setupPool: pg.Pool;

async function createTables(pool: pg.Pool) {
  await pool.query(`
    DROP TABLE IF EXISTS user_integrations CASCADE;
    DROP TABLE IF EXISTS bots CASCADE;

    CREATE TABLE IF NOT EXISTS bots (
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

    CREATE TABLE IF NOT EXISTS user_integrations (
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
  `);
}

async function truncateAll(pool: pg.Pool) {
  await pool.query("TRUNCATE user_integrations, bots CASCADE");
}

function buildApp() {
  const app = new OpenAPIHono<AppBindings>();
  registerComposioRoutes(app);
  return app;
}

const now = () => new Date().toISOString();

async function seedBot(
  pool: pg.Pool,
  overrides: Partial<{ id: string; userId: string; name: string }> = {},
) {
  const b = {
    id: overrides.id ?? "bot-1",
    userId: overrides.userId ?? "user-1",
    name: overrides.name ?? "Test Bot",
  };
  const n = now();
  await pool.query(
    `INSERT INTO bots (id, user_id, name, slug, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [b.id, b.userId, b.name, b.name.toLowerCase().replace(/\s+/g, "-"), n, n],
  );
  return b;
}

async function seedIntegration(
  pool: pg.Pool,
  overrides: Partial<{
    id: string;
    userId: string;
    toolkitSlug: string;
    status: string;
    composioAccountId: string | null;
  }> = {},
) {
  const i = {
    id: overrides.id ?? `int-${Math.random().toString(36).slice(2, 8)}`,
    userId: overrides.userId ?? "user-1",
    toolkitSlug: overrides.toolkitSlug ?? "gmail",
    status: overrides.status ?? "active",
    composioAccountId:
      "composioAccountId" in overrides
        ? overrides.composioAccountId
        : "ca_test123",
  };
  const n = now();
  await pool.query(
    `INSERT INTO user_integrations (id, user_id, toolkit_slug, status, composio_account_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [i.id, i.userId, i.toolkitSlug, i.status, i.composioAccountId, n, n],
  );
  return i;
}

function makeRequest(
  app: ReturnType<typeof buildApp>,
  body: Record<string, unknown>,
  token = SKILL_TOKEN,
) {
  return app.request("/api/internal/composio/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-token": token,
    },
    body: JSON.stringify(body),
  });
}

describe("Composio Routes", () => {
  const app = buildApp();

  beforeAll(async () => {
    process.env.SKILL_API_TOKEN = SKILL_TOKEN;
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
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
  // Test 1: Valid execute request (happy path)
  // ----------------------------------------------------------------
  it("executes action successfully with valid request", async () => {
    await seedBot(setupPool);
    await seedIntegration(setupPool, {
      toolkitSlug: "gmail",
      composioAccountId: "ca_happy",
    });

    const res = await makeRequest(app, {
      botId: "bot-1",
      action: "GMAIL_SEND_EMAIL",
      params: { to: "user@example.com", subject: "Hi" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successful).toBe(true);
    expect(body.data).toBeDefined();
    expect(executeAction).toHaveBeenCalledWith(
      expect.any(String),
      "ca_happy",
      "user-1",
      "GMAIL_SEND_EMAIL",
      {
        to: "user@example.com",
        subject: "Hi",
      },
    );
  });

  // ----------------------------------------------------------------
  // Test 2: Missing botId
  // ----------------------------------------------------------------
  it("returns 400 when botId is missing", async () => {
    const res = await makeRequest(app, {
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(400);
  });

  // ----------------------------------------------------------------
  // Test 3: Invalid action format
  // ----------------------------------------------------------------
  it("returns 400 for invalid action format", async () => {
    const res = await makeRequest(app, {
      botId: "bot-1",
      action: "invalid_lowercase",
      params: {},
    });

    expect(res.status).toBe(400);
  });

  // ----------------------------------------------------------------
  // Test 4: Bot not found
  // ----------------------------------------------------------------
  it("returns 404 when bot not found", async () => {
    const res = await makeRequest(app, {
      botId: "nonexistent-bot",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe("Bot not found");
  });

  // ----------------------------------------------------------------
  // Test 5: User has no active integration
  // ----------------------------------------------------------------
  it("returns 403 when user has no active integration", async () => {
    await seedBot(setupPool);
    // No integration seeded

    const res = await makeRequest(app, {
      botId: "bot-1",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toContain("not connected");
    expect(body.message).toContain("gmail");
  });

  // ----------------------------------------------------------------
  // Test 6: Unknown toolkit from action prefix
  // ----------------------------------------------------------------
  it("returns 400 for unknown toolkit prefix", async () => {
    await seedBot(setupPool);

    const res = await makeRequest(app, {
      botId: "bot-1",
      action: "UNKNOWNTOOL_DO_SOMETHING",
      params: {},
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toContain("Unknown toolkit");
  });

  // ----------------------------------------------------------------
  // Test 7: Composio SDK returns error (successful: false)
  // ----------------------------------------------------------------
  it("returns 200 with error when Composio returns unsuccessful", async () => {
    await seedBot(setupPool);
    await seedIntegration(setupPool);

    vi.mocked(executeAction).mockResolvedValueOnce({
      data: null,
      error: "Rate limit exceeded",
      successful: false,
    });

    const res = await makeRequest(app, {
      botId: "bot-1",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successful).toBe(false);
    expect(body.error).toBe("Rate limit exceeded");
  });

  // ----------------------------------------------------------------
  // Test 8: Composio SDK throws exception
  // ----------------------------------------------------------------
  it("returns 502 when Composio SDK throws", async () => {
    await seedBot(setupPool);
    await seedIntegration(setupPool);

    vi.mocked(executeAction).mockRejectedValueOnce(
      new Error("Network timeout"),
    );

    const res = await makeRequest(app, {
      botId: "bot-1",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).toBe("Failed to execute action");
  });

  // ----------------------------------------------------------------
  // Test 9: Missing auth token
  // ----------------------------------------------------------------
  it("returns error when no auth token provided", async () => {
    const res = await app.request("/api/internal/composio/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botId: "bot-1",
        action: "GMAIL_SEND_EMAIL",
        params: {},
      }),
    });

    // MiddlewareError results in 500 (caught by error handler)
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ----------------------------------------------------------------
  // Test 10: Invalid token
  // ----------------------------------------------------------------
  it("returns error when invalid token provided", async () => {
    const res = await makeRequest(
      app,
      {
        botId: "bot-1",
        action: "GMAIL_SEND_EMAIL",
        params: {},
      },
      "wrong-token",
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ----------------------------------------------------------------
  // Test: Integration disconnected
  // ----------------------------------------------------------------
  it("returns 403 when integration is disconnected", async () => {
    await seedBot(setupPool);
    await seedIntegration(setupPool, {
      toolkitSlug: "gmail",
      status: "disconnected",
    });

    const res = await makeRequest(app, {
      botId: "bot-1",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(403);
  });

  // ----------------------------------------------------------------
  // Test: Missing composioAccountId
  // ----------------------------------------------------------------
  it("returns 403 when composioAccountId is missing", async () => {
    await seedBot(setupPool);
    await seedIntegration(setupPool, {
      toolkitSlug: "gmail",
      status: "active",
      composioAccountId: null,
    });

    const res = await makeRequest(app, {
      botId: "bot-1",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toContain("missing account credentials");
  });
});
