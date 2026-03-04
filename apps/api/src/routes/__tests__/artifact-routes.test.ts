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

// Mock the shared db singleton so route handlers use the test database.
// vi.mock is hoisted above imports, so this runs before artifact-routes.ts
// resolves its `import { db } from "../db/index.js"`.
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

import { registerArtifactInternalRoutes } from "../artifact-routes.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

let setupPool: pg.Pool;

async function createTables(pool: pg.Pool) {
  await pool.query(`
    DROP TABLE IF EXISTS artifacts CASCADE;
    DROP TABLE IF EXISTS bots CASCADE;

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

    CREATE TABLE artifacts (
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
  `);
}

async function truncateAll(pool: pg.Pool) {
  await pool.query("TRUNCATE artifacts, bots CASCADE");
}

function buildApp() {
  const app = new OpenAPIHono();
  registerArtifactInternalRoutes(app);
  return app;
}

const TOKEN = "test-internal-token";

describe("Artifact Internal Routes", () => {
  const app = buildApp();

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    process.env.SKILL_API_TOKEN = TOKEN;
    setupPool = new pg.Pool({ connectionString: TEST_DB_URL });
    await createTables(setupPool);
  });

  afterAll(async () => {
    await setupPool.end();
  });

  beforeEach(async () => {
    await truncateAll(setupPool);
    const now = new Date().toISOString();
    await setupPool.query(
      `INSERT INTO bots (id, user_id, name, slug, status, created_at, updated_at)
       VALUES ('bot-test-1', 'user-1', 'Test Bot', 'test-bot', 'active', $1, $2)`,
      [now, now],
    );
  });

  // ----------------------------------------------------------------
  // POST /api/internal/artifacts
  // ----------------------------------------------------------------

  describe("POST /api/internal/artifacts", () => {
    it("creates an artifact with minimal required fields", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "My Landing Page",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.botId).toBe("bot-test-1");
      expect(body.title).toBe("My Landing Page");
      expect(body.status).toBe("building"); // default
    });

    it("creates an artifact with all deployment fields", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Static Site Deploy",
          artifactType: "deployment",
          source: "coding",
          status: "live",
          previewUrl: "https://my-site.nexu.space",
          deployTarget: "cloudflare-pages",
          fileCount: 5,
          sessionKey: "agent:my-bot:slack-T123-U456",
          channelType: "slack",
          channelId: "C0123456",
          metadata: { slug: "my-site", isNewProject: true },
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("live");
      expect(body.artifactType).toBe("deployment");
      expect(body.source).toBe("coding");
      expect(body.deployTarget).toBe("cloudflare-pages");
      expect(body.fileCount).toBe(5);
      expect(body.previewUrl).toBe("https://my-site.nexu.space");
      expect(body.sessionKey).toBe("agent:my-bot:slack-T123-U456");
      expect(body.channelType).toBe("slack");
      expect(body.channelId).toBe("C0123456");
      expect(body.metadata).toEqual({ slug: "my-site", isNewProject: true });
    });

    it("defaults status to building when not provided", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({ botId: "bot-test-1", title: "Draft" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("building");
    });

    it("returns 400 for unknown botId", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-does-not-exist",
          title: "Test",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe("Bot not found");
    });

    it("returns 400 when botId is missing", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({ title: "No Bot" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 when title is missing", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({ botId: "bot-test-1" }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ----------------------------------------------------------------
  // PATCH /api/internal/artifacts/:id
  // ----------------------------------------------------------------

  describe("PATCH /api/internal/artifacts/:id", () => {
    async function createArtifact(overrides: Record<string, unknown> = {}) {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Build in Progress",
          status: "building",
          ...overrides,
        }),
      });
      return (await res.json()) as { id: string };
    }

    it("updates status from building to live", async () => {
      const created = await createArtifact();

      const res = await app.request(`/api/internal/artifacts/${created.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          status: "live",
          previewUrl: "https://done.nexu.space",
          fileCount: 10,
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("live");
      expect(body.previewUrl).toBe("https://done.nexu.space");
      expect(body.fileCount).toBe(10);
    });

    it("updates status to failed", async () => {
      const created = await createArtifact();

      const res = await app.request(`/api/internal/artifacts/${created.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({ status: "failed" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe("failed");
    });

    it("updates metadata", async () => {
      const created = await createArtifact();

      const res = await app.request(`/api/internal/artifacts/${created.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          metadata: { deploymentUrl: "https://abc123.nexu.pages.dev" },
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.metadata).toEqual({
        deploymentUrl: "https://abc123.nexu.pages.dev",
      });
    });

    it("returns 404 for unknown artifact id", async () => {
      const res = await app.request("/api/internal/artifacts/nonexistent-id", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({ status: "live" }),
      });

      expect(res.status).toBe(404);
    });
  });
});
