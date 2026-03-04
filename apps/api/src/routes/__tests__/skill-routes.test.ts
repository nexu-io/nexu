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

import { MiddlewareError } from "../../lib/error.js";
import { registerSkillRoutes } from "../skill-routes.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://nexu:nexu@localhost:5433/nexu_test";

const TOKEN = "test-internal-token";

let setupPool: pg.Pool;

async function createTables(pool: pg.Pool) {
  await pool.query(`
    DROP TABLE IF EXISTS skills_snapshots CASCADE;
    DROP TABLE IF EXISTS skills CASCADE;

    CREATE TABLE skills (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      files TEXT NOT NULL DEFAULT '{}',
      status TEXT DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE skills_snapshots (
      pk SERIAL PRIMARY KEY,
      id TEXT NOT NULL UNIQUE,
      version INTEGER NOT NULL UNIQUE,
      skills_hash TEXT NOT NULL,
      skills_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

async function truncateAll(pool: pg.Pool) {
  await pool.query("TRUNCATE skills_snapshots, skills CASCADE");
}

function buildApp() {
  const app = new OpenAPIHono();
  app.onError((err, c) => {
    if (err instanceof MiddlewareError) {
      const code = err.context.code;
      const status = code === "internal_token_invalid" ? 401 : 500;
      return c.json({ message: err.message }, status);
    }
    return c.json({ message: "Internal Server Error" }, 500);
  });
  registerSkillRoutes(app as Parameters<typeof registerSkillRoutes>[0]);
  return app;
}

describe("Skill Routes", () => {
  const app = buildApp();

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = TOKEN;
    setupPool = new pg.Pool({ connectionString: TEST_DB_URL });
    await createTables(setupPool);
  });

  afterAll(async () => {
    await setupPool.end();
  });

  beforeEach(async () => {
    await truncateAll(setupPool);
  });

  const AUTH = { "x-internal-token": TOKEN };

  // ----------------------------------------------------------------
  // PUT /api/internal/skills/:name
  // ----------------------------------------------------------------

  describe("PUT /api/internal/skills/:name", () => {
    it("1. valid name + content → first upsert returns version 1", async () => {
      const res = await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "# My Skill\n\nDoes stuff." }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        name: string;
        version: number;
      };
      expect(body.ok).toBe(true);
      expect(body.name).toBe("my-skill");
      expect(body.version).toBe(1);
    });

    it("2. same content again → idempotent, same version", async () => {
      const content = "# Same content";
      await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content }),
      });

      const res = await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { version: number };
      expect(body.version).toBe(1);
    });

    it("3. different content → new snapshot, version 2", async () => {
      await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "v1" }),
      });

      const res = await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "v2" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { version: number };
      expect(body.version).toBe(2);
    });

    it("4. set status inactive → skill excluded from GET", async () => {
      await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "active content" }),
      });

      await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "active content", status: "inactive" }),
      });

      const getRes = await app.request("/api/internal/skills/latest", {
        method: "GET",
        headers: AUTH,
      });
      const getBody = (await getRes.json()) as {
        skills: Record<string, Record<string, string>>;
      };
      expect(getBody.skills["my-skill"]).toBeUndefined();
    });

    it("5. invalid name ../escape → 400", async () => {
      const res = await app.request("/api/internal/skills/..%2Fescape", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "evil" }),
      });

      expect(res.status).toBe(400);
    });

    it("6. uppercase name MySkill → 400", async () => {
      const res = await app.request("/api/internal/skills/MySkill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "caps" }),
      });

      expect(res.status).toBe(400);
    });

    it("7. missing content → 400", async () => {
      const res = await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("8. missing token → 401", async () => {
      const res = await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(res.status).toBe(401);
    });

    it("9. wrong token → 401", async () => {
      const res = await app.request("/api/internal/skills/my-skill", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": "wrong-token",
        },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------------
  // GET /api/internal/skills/latest
  // ----------------------------------------------------------------

  describe("GET /api/internal/skills/latest", () => {
    it("10. no skills → 200 with empty skills map", async () => {
      const res = await app.request("/api/internal/skills/latest", {
        method: "GET",
        headers: AUTH,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        version: number;
        skills: Record<string, Record<string, string>>;
        skillsHash: string;
      };
      expect(body.version).toBe(1);
      expect(body.skills).toEqual({});
      expect(typeof body.skillsHash).toBe("string");
    });

    it("11. one active skill → skill appears in response", async () => {
      await app.request("/api/internal/skills/hello-world", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "# Hello World" }),
      });

      const res = await app.request("/api/internal/skills/latest", {
        method: "GET",
        headers: AUTH,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        skills: Record<string, Record<string, string>>;
      };
      expect(body.skills["hello-world"]).toEqual({
        "SKILL.md": "# Hello World",
      });
    });

    it("12. active + inactive → only active in response", async () => {
      await app.request("/api/internal/skills/active-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "active" }),
      });
      await app.request("/api/internal/skills/inactive-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "inactive", status: "inactive" }),
      });

      const res = await app.request("/api/internal/skills/latest", {
        method: "GET",
        headers: AUTH,
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        skills: Record<string, Record<string, string>>;
      };
      expect(body.skills["active-skill"]).toEqual({
        "SKILL.md": "active",
      });
      expect(body.skills["inactive-skill"]).toBeUndefined();
    });

    it("13. two consecutive GETs, no changes → same version + hash", async () => {
      await app.request("/api/internal/skills/stable-skill", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "stable" }),
      });

      const res1 = await app.request("/api/internal/skills/latest", {
        method: "GET",
        headers: AUTH,
      });
      const res2 = await app.request("/api/internal/skills/latest", {
        method: "GET",
        headers: AUTH,
      });

      const body1 = (await res1.json()) as {
        version: number;
        skillsHash: string;
      };
      const body2 = (await res2.json()) as {
        version: number;
        skillsHash: string;
      };
      expect(body1.version).toBe(body2.version);
      expect(body1.skillsHash).toBe(body2.skillsHash);
    });

    it("14. missing token → 401", async () => {
      const res = await app.request("/api/internal/skills/latest", {
        method: "GET",
      });

      expect(res.status).toBe(401);
    });
  });

  // ----------------------------------------------------------------
  // Concurrent
  // ----------------------------------------------------------------

  describe("concurrent PUT", () => {
    it("15. two parallel PUTs, different content → no duplicate version error", async () => {
      const [res1, res2] = await Promise.all([
        app.request("/api/internal/skills/skill-a", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...AUTH },
          body: JSON.stringify({ content: "content-a" }),
        }),
        app.request("/api/internal/skills/skill-b", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...AUTH },
          body: JSON.stringify({ content: "content-b" }),
        }),
      ]);

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
    });

    it("16. two parallel PUTs, same content → idempotent, same hash", async () => {
      const content = "# Shared content";

      const [res1, res2] = await Promise.all([
        app.request("/api/internal/skills/shared-skill", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...AUTH },
          body: JSON.stringify({ content }),
        }),
        app.request("/api/internal/skills/shared-skill", {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...AUTH },
          body: JSON.stringify({ content }),
        }),
      ]);

      expect([200, 200]).toContain(res1.status);
      expect([200, 200]).toContain(res2.status);

      const body1 = (await res1.json()) as { version: number };
      const body2 = (await res2.json()) as { version: number };
      expect(body1.version).toBe(body2.version);
    });
  });

  // ----------------------------------------------------------------
  // Rollback scenario
  // ----------------------------------------------------------------

  describe("rollback (hash reuse)", () => {
    it("17. add A → add B → remove B → new version created (not stale v1)", async () => {
      // Step 1: add skill-a → version 1
      const res1 = await app.request("/api/internal/skills/skill-a", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "content-a" }),
      });
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { version: number };
      expect(body1.version).toBe(1);

      // Step 2: add skill-b → version 2 (different hash)
      const res2 = await app.request("/api/internal/skills/skill-b", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "content-b" }),
      });
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as { version: number };
      expect(body2.version).toBe(2);

      // Step 3: set skill-b inactive → hash reverts to same as v1
      const res3 = await app.request("/api/internal/skills/skill-b", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...AUTH },
        body: JSON.stringify({ content: "content-b", status: "inactive" }),
      });
      expect(res3.status).toBe(200);
      const body3 = (await res3.json()) as { version: number };

      // Must be version 3, NOT version 1 (stale)
      expect(body3.version).toBe(3);

      // Verify GET returns the correct latest
      const getRes = await app.request("/api/internal/skills/latest", {
        method: "GET",
        headers: AUTH,
      });
      const getBody = (await getRes.json()) as {
        version: number;
        skills: Record<string, Record<string, string>>;
      };
      expect(getBody.version).toBe(3);
      expect(getBody.skills["skill-a"]).toEqual({
        "SKILL.md": "content-a",
      });
      expect(getBody.skills["skill-b"]).toBeUndefined();
    });
  });
});
