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

vi.mock("../../db/index.js", async () => {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { default: PgPool } = await import("pg");
  const schemaModule = await import("../../db/schema/index.js");
  const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://nexu:nexu@localhost:5433/nexu_test";
  const pool = new PgPool.Pool({ connectionString: url });
  return {
    db: drizzle(pool, { schema: schemaModule }),
    pool,
  };
});

vi.mock("../../lib/composio.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    executeAction: vi.fn().mockResolvedValue({
      data: { result: "ok" },
      error: null,
      successful: true,
    }),
  };
});

import { executeAction } from "../../lib/composio.js";
import { registerComposioRoutes } from "../composio-routes.js";

import type { AppBindings } from "../../types.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

const SKILL_TOKEN = "e2e-skill-token";
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
    id: overrides.id ?? "e2e-bot-1",
    userId: overrides.userId ?? "e2e-user-1",
    name: overrides.name ?? "E2E Bot",
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
    userId: overrides.userId ?? "e2e-user-1",
    toolkitSlug: overrides.toolkitSlug ?? "gmail",
    status: overrides.status ?? "active",
    composioAccountId: overrides.composioAccountId ?? "ca_e2e_test",
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

describe("Composio Routes E2E", () => {
  const app = buildApp();

  beforeAll(async () => {
    process.env.SKILL_API_TOKEN = SKILL_TOKEN;
    process.env.INTERNAL_API_TOKEN = "e2e-internal-token";
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
  // Scenario 1: Full execution flow
  // ----------------------------------------------------------------
  it("executes full flow: bot → user → integration → Composio", async () => {
    await seedBot(setupPool, { id: "bot-full", userId: "user-full" });
    await seedIntegration(setupPool, {
      userId: "user-full",
      toolkitSlug: "gmail",
      composioAccountId: "ca_full_flow",
    });

    const res = await makeRequest(app, {
      botId: "bot-full",
      action: "GMAIL_LIST_EMAILS",
      params: { max_results: 5 },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successful).toBe(true);
    expect(executeAction).toHaveBeenCalledWith(
      "test-composio-api-key",
      "ca_full_flow",
      "user-full",
      "GMAIL_LIST_EMAILS",
      {
        max_results: 5,
      },
    );
  });

  // ----------------------------------------------------------------
  // Scenario 2: Cross-user isolation
  // ----------------------------------------------------------------
  it("prevents cross-user access: bot owner ≠ integration owner", async () => {
    await seedBot(setupPool, { id: "bot-a", userId: "user-a" });
    await seedIntegration(setupPool, {
      userId: "user-b",
      toolkitSlug: "gmail",
    });

    const res = await makeRequest(app, {
      botId: "bot-a",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.message).toContain("not connected");
  });

  // ----------------------------------------------------------------
  // Scenario 3: Integration not connected
  // ----------------------------------------------------------------
  it("rejects when no integration exists", async () => {
    await seedBot(setupPool, { id: "bot-no-int", userId: "user-no-int" });

    const res = await makeRequest(app, {
      botId: "bot-no-int",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(403);
  });

  // ----------------------------------------------------------------
  // Scenario 4: Integration disconnected
  // ----------------------------------------------------------------
  it("rejects disconnected integration", async () => {
    await seedBot(setupPool, { id: "bot-disc", userId: "user-disc" });
    await seedIntegration(setupPool, {
      userId: "user-disc",
      toolkitSlug: "gmail",
      status: "disconnected",
    });

    const res = await makeRequest(app, {
      botId: "bot-disc",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(403);
  });

  // ----------------------------------------------------------------
  // Scenario 5: Multiple bots, each uses own user's integrations
  // ----------------------------------------------------------------
  it("isolates bots in same pool to their own user integrations", async () => {
    await seedBot(setupPool, { id: "bot-x", userId: "user-x" });
    await seedBot(setupPool, { id: "bot-y", userId: "user-y" });
    await seedIntegration(setupPool, {
      userId: "user-x",
      toolkitSlug: "gmail",
      composioAccountId: "ca_user_x",
    });
    await seedIntegration(setupPool, {
      userId: "user-y",
      toolkitSlug: "gmail",
      composioAccountId: "ca_user_y",
    });

    // bot-x uses user-x's integration
    const resX = await makeRequest(app, {
      botId: "bot-x",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });
    expect(resX.status).toBe(200);
    expect(executeAction).toHaveBeenCalledWith(
      "test-composio-api-key",
      "ca_user_x",
      "user-x",
      "GMAIL_SEND_EMAIL",
      {},
    );

    vi.clearAllMocks();

    // bot-y uses user-y's integration
    const resY = await makeRequest(app, {
      botId: "bot-y",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });
    expect(resY.status).toBe(200);
    expect(executeAction).toHaveBeenCalledWith(
      "test-composio-api-key",
      "ca_user_y",
      "user-y",
      "GMAIL_SEND_EMAIL",
      {},
    );
  });

  // ----------------------------------------------------------------
  // Scenario 6: Action prefix resolution
  // ----------------------------------------------------------------
  it("resolves action prefix to correct toolkit", async () => {
    await seedBot(setupPool);
    await seedIntegration(setupPool, { toolkitSlug: "googlecalendar" });

    const res = await makeRequest(app, {
      botId: "e2e-bot-1",
      action: "GOOGLECALENDAR_CREATE_EVENT",
      params: { summary: "Test" },
    });

    expect(res.status).toBe(200);
    expect(executeAction).toHaveBeenCalledWith(
      "test-composio-api-key",
      "ca_e2e_test",
      "e2e-user-1",
      "GOOGLECALENDAR_CREATE_EVENT",
      { summary: "Test" },
    );
  });

  // ----------------------------------------------------------------
  // Scenario 7: Composio failure recovery
  // ----------------------------------------------------------------
  it("returns 502 on Composio exception without leaking internals", async () => {
    await seedBot(setupPool);
    await seedIntegration(setupPool);

    vi.mocked(executeAction).mockRejectedValueOnce(
      new Error("Composio internal: db connection failed at shard-3"),
    );

    const res = await makeRequest(app, {
      botId: "e2e-bot-1",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.message).toBe("Failed to execute action");
    expect(body.message).not.toContain("shard");
  });

  // ----------------------------------------------------------------
  // Scenario 8: Token auth required
  // ----------------------------------------------------------------
  it("rejects request without auth token", async () => {
    const res = await app.request("/api/internal/composio/execute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        botId: "e2e-bot-1",
        action: "GMAIL_SEND_EMAIL",
        params: {},
      }),
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ----------------------------------------------------------------
  // Scenario 9: SKILL_API_TOKEN accepted
  // ----------------------------------------------------------------
  it("accepts SKILL_API_TOKEN for auth", async () => {
    await seedBot(setupPool);
    await seedIntegration(setupPool);

    const res = await makeRequest(app, {
      botId: "e2e-bot-1",
      action: "GMAIL_SEND_EMAIL",
      params: {},
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.successful).toBe(true);
  });
});
