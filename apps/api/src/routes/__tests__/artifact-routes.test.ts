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
    DROP TABLE IF EXISTS sessions CASCADE;
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

    CREATE TABLE sessions (
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
  `);
}

async function truncateAll(pool: pg.Pool) {
  await pool.query("TRUNCATE artifacts, sessions, bots CASCADE");
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
  // POST /api/internal/artifacts/check-domain
  // ----------------------------------------------------------------

  describe("POST /api/internal/artifacts/check-domain", () => {
    it("returns available when previewUrl is unused", async () => {
      const res = await app.request("/api/internal/artifacts/check-domain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          chatId: "user:U0AHLMC6C8G",
          previewUrl: "https://family-budget.nexu.space",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.available).toBe(true);
      expect(body.sessionKey).toBe("agent:bot-test-1:main");
      expect(body.existingArtifactId).toBeNull();
      expect(body.existingSessionKey).toBeNull();
    });

    it("returns available when previewUrl belongs to the same session", async () => {
      const first = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Deploy",
          chatId: "user:U0AHLMC6C8G",
          previewUrl: "https://family-budget.nexu.space",
        }),
      });
      expect(first.status).toBe(201);
      const firstBody = await first.json();

      const res = await app.request("/api/internal/artifacts/check-domain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          chatId: "user:U0AHLMC6C8G",
          previewUrl: "https://family-budget.nexu.space",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.available).toBe(true);
      expect(body.existingArtifactId).toBe(firstBody.id);
      expect(body.existingSessionKey).toBe("agent:bot-test-1:main");
    });

    it("returns 409 when previewUrl belongs to another session", async () => {
      const first = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Deploy",
          chatId: "user:U0AHLMC6C8G",
          previewUrl: "https://family-budget.nexu.space",
        }),
      });
      expect(first.status).toBe(201);

      const now = new Date().toISOString();
      await setupPool.query(
        `INSERT INTO sessions (id, bot_id, session_key, channel_type, channel_id, title, status, created_at, updated_at)
         VALUES ('sess-1', 'bot-test-1', 'agent:bot-test-1:slack:channel:c0ajkg60h6d', 'slack', 'c0ajkg60h6d', 'Slack #general', 'active', $1, $2)`,
        [now, now],
      );

      const res = await app.request("/api/internal/artifacts/check-domain", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          chatId: "channel:C0AJKG60H6D",
          channelType: "slack",
          previewUrl: "https://family-budget.nexu.space",
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.message).toBe(
        "previewUrl is already in use by another session",
      );
    });
  });

  // ----------------------------------------------------------------
  // POST /api/internal/artifacts
  // ----------------------------------------------------------------

  describe("POST /api/internal/artifacts", () => {
    it("returns 400 when neither sessionKey nor chatId is provided", async () => {
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

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe("sessionKey or chatId is required");
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
      expect(body.sessionKey).toBe("agent:my-bot:slack-t123-u456");
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
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Draft",
          chatId: "user:U0AHLMC6C8G",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.status).toBe("building");
    });

    it("returns 400 when threadId is provided without chatId", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Orphan Thread",
          threadId: "1770408518.451689",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe("threadId requires chatId");
    });

    it("resolves DM artifacts from chatId", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "DM Deploy",
          chatId: "user:U0AHLMC6C8G",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.sessionKey).toBe("agent:bot-test-1:main");
    });

    it("resolves DM thread artifacts from chatId and threadId", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "DM Thread Deploy",
          chatId: "user:U0AHLMC6C8G",
          threadId: "1770408518.451689",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.sessionKey).toBe(
        "agent:bot-test-1:main:thread:1770408518.451689",
      );
    });

    it("deduplicates inserts by sessionKey and previewUrl", async () => {
      const first = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "First Deploy",
          chatId: "user:U0AHLMC6C8G",
          previewUrl: "https://my-site.nexu.space",
          status: "live",
          fileCount: 1,
        }),
      });

      expect(first.status).toBe(201);
      const firstBody = await first.json();

      const second = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Second Deploy",
          chatId: "user:U0AHLMC6C8G",
          previewUrl: "https://my-site.nexu.space",
          status: "live",
          fileCount: 2,
        }),
      });

      expect(second.status).toBe(201);
      const secondBody = await second.json();
      expect(secondBody.id).toBe(firstBody.id);
      expect(secondBody.title).toBe("Second Deploy");
      expect(secondBody.fileCount).toBe(2);

      const { rows } = await setupPool.query(
        "SELECT id, title, file_count FROM artifacts ORDER BY created_at ASC",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: firstBody.id,
        title: "Second Deploy",
        file_count: 2,
      });
    });

    it("returns 409 when previewUrl is already owned by another session", async () => {
      const first = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "DM Deploy",
          chatId: "user:U0AHLMC6C8G",
          previewUrl: "https://shared.nexu.space",
        }),
      });
      expect(first.status).toBe(201);

      const now = new Date().toISOString();
      await setupPool.query(
        `INSERT INTO sessions (id, bot_id, session_key, channel_type, channel_id, title, status, created_at, updated_at)
         VALUES ('sess-1', 'bot-test-1', 'agent:bot-test-1:slack:channel:c0ajkg60h6d', 'slack', 'c0ajkg60h6d', 'Slack #general', 'active', $1, $2)`,
        [now, now],
      );

      const second = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Channel Deploy",
          chatId: "channel:C0AJKG60H6D",
          channelType: "slack",
          previewUrl: "https://shared.nexu.space",
        }),
      });

      expect(second.status).toBe(409);
      const body = await second.json();
      expect(body.message).toBe(
        "previewUrl is already in use by another session",
      );

      const { rows } = await setupPool.query(
        "SELECT session_key FROM artifacts",
      );
      expect(rows).toHaveLength(1);
    });

    it("resolves channel artifacts from exact session rows", async () => {
      const now = new Date().toISOString();
      await setupPool.query(
        `INSERT INTO sessions (id, bot_id, session_key, channel_type, channel_id, title, status, created_at, updated_at)
         VALUES ('sess-1', 'bot-test-1', 'agent:bot-test-1:slack:channel:c0ajkg60h6d', 'slack', 'c0ajkg60h6d', 'Slack #general', 'active', $1, $2)`,
        [now, now],
      );

      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Channel Deploy",
          chatId: "channel:C0AJKG60H6D",
          channelType: "slack",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.sessionKey).toBe(
        "agent:bot-test-1:slack:channel:c0ajkg60h6d",
      );
    });

    it("appends thread ids to resolved channel sessions", async () => {
      const now = new Date().toISOString();
      await setupPool.query(
        `INSERT INTO sessions (id, bot_id, session_key, channel_type, channel_id, title, status, created_at, updated_at)
         VALUES ('sess-1', 'bot-test-1', 'agent:bot-test-1:slack:channel:c0ajkg60h6d', 'slack', 'c0ajkg60h6d', 'Slack #general', 'active', $1, $2)`,
        [now, now],
      );

      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Thread Deploy",
          chatId: "channel:C0AJKG60H6D",
          channelType: "slack",
          threadId: "1770408518.451689",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.sessionKey).toBe(
        "agent:bot-test-1:slack:channel:c0ajkg60h6d:thread:1770408518.451689",
      );
    });

    it("returns 400 for malformed non-agent session keys", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Bad Key",
          sessionKey: "slack-xxx:user:yyy",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe("sessionKey must start with agent:");
    });

    it("returns 400 when channel chatId resolution is ambiguous", async () => {
      const now = new Date().toISOString();
      await setupPool.query(
        `INSERT INTO sessions (id, bot_id, session_key, channel_type, channel_id, title, status, created_at, updated_at)
         VALUES
         ('sess-1', 'bot-test-1', 'agent:bot-test-1:slack:channel:c0ajkg60h6d', 'slack', 'c0ajkg60h6d', 'Slack #general', 'active', $1, $2),
         ('sess-2', 'bot-test-1', 'agent:bot-test-1:discord:channel:c0ajkg60h6d', 'discord', 'c0ajkg60h6d', 'Discord General', 'active', $1, $2)`,
        [now, now],
      );

      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Ambiguous Channel",
          chatId: "channel:C0AJKG60H6D",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe("Ambiguous session resolution for chatId");
    });

    it("resolves correctly when legacy and truncated session keys exist", async () => {
      const now = new Date().toISOString();
      // Seed 3 sessions for the same bot+channel with different key formats:
      // 1. Legacy pre-agent format
      // 2. Truncated (missing :channel:xxx)
      // 3. Valid agent:*:channel:* format
      await setupPool.query(
        `INSERT INTO sessions (id, bot_id, session_key, channel_type, channel_id, title, status, created_at, updated_at)
         VALUES
         ('sess-legacy', 'bot-test-1', 'slack_T09CNAG1BP0_C0AJKG60H6D', 'slack', 'c0ajkg60h6d', 'Legacy Session', 'active', $1, $2),
         ('sess-truncated', 'bot-test-1', 'agent:bot-test-1:slack', 'slack', 'c0ajkg60h6d', 'Truncated Session', 'active', $1, $2),
         ('sess-valid', 'bot-test-1', 'agent:bot-test-1:slack:channel:c0ajkg60h6d', 'slack', 'c0ajkg60h6d', 'Valid Session', 'active', $1, $2)`,
        [now, now],
      );

      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Deploy with Legacy Data",
          chatId: "channel:C0AJKG60H6D",
          channelType: "slack",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.sessionKey).toBe(
        "agent:bot-test-1:slack:channel:c0ajkg60h6d",
      );
    });

    it("returns 400 when channel chatId has no exact session", async () => {
      const res = await app.request("/api/internal/artifacts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": TOKEN,
        },
        body: JSON.stringify({
          botId: "bot-test-1",
          title: "Missing Channel",
          chatId: "channel:C0AJKG60H6D",
          channelType: "slack",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.message).toBe("No matching session found for chatId");
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
          chatId: "user:U0AHLMC6C8G",
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
