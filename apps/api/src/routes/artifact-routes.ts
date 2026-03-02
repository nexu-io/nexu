import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  artifactListResponseSchema,
  artifactResponseSchema,
  artifactStatsResponseSchema,
  createArtifactSchema,
  updateArtifactSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { artifacts, bots } from "../db/schema/index.js";
import { ServiceError } from "../lib/error.js";
import { requireInternalToken } from "../middleware/internal-auth.js";
import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const artifactIdParam = z.object({
  id: z.string(),
});

// --- Helper ---

function formatArtifact(row: typeof artifacts.$inferSelect) {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    botId: row.botId,
    sessionKey: row.sessionKey ?? null,
    channelType: row.channelType ?? null,
    channelId: row.channelId ?? null,
    title: row.title,
    artifactType: row.artifactType ?? null,
    source: row.source ?? null,
    contentType: row.contentType ?? null,
    status: row.status ?? "building",
    previewUrl: row.previewUrl ?? null,
    deployTarget: row.deployTarget ?? null,
    linesOfCode: row.linesOfCode ?? null,
    fileCount: row.fileCount ?? null,
    durationMs: row.durationMs ?? null,
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ============================================================
// Internal routes (before auth middleware)
// ============================================================

const createArtifactRoute = createRoute({
  method: "post",
  path: "/api/internal/artifacts",
  tags: ["Artifacts (Internal)"],
  request: {
    body: {
      content: { "application/json": { schema: createArtifactSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: artifactResponseSchema } },
      description: "Artifact created",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
  },
});

const updateArtifactInternalRoute = createRoute({
  method: "patch",
  path: "/api/internal/artifacts/{id}",
  tags: ["Artifacts (Internal)"],
  request: {
    params: artifactIdParam,
    body: {
      content: { "application/json": { schema: updateArtifactSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: artifactResponseSchema } },
      description: "Artifact updated",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Artifact not found",
    },
  },
});

export function registerArtifactInternalRoutes(app: OpenAPIHono<AppBindings>) {
  // POST /api/internal/artifacts — Skill creates an artifact
  app.openapi(createArtifactRoute, async (c) => {
    requireInternalToken(c);
    const input = c.req.valid("json");

    // Verify botId exists
    const [bot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(eq(bots.id, input.botId));

    if (!bot) {
      return c.json({ message: "Bot not found" }, 400);
    }

    const now = new Date().toISOString();
    const id = createId();

    await db.insert(artifacts).values({
      id,
      botId: input.botId,
      title: input.title,
      sessionKey: input.sessionKey,
      channelType: input.channelType,
      channelId: input.channelId,
      artifactType: input.artifactType,
      source: input.source,
      contentType: input.contentType,
      status: input.status ?? "building",
      previewUrl: input.previewUrl,
      deployTarget: input.deployTarget,
      linesOfCode: input.linesOfCode,
      fileCount: input.fileCount,
      durationMs: input.durationMs,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
      createdAt: now,
      updatedAt: now,
    });

    const [created] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id));

    if (!created) {
      throw ServiceError.from("artifact-routes", {
        code: "artifact_insert_failed",
        artifact_id: id,
        bot_id: input.botId,
      });
    }

    return c.json(formatArtifact(created), 201);
  });

  // PATCH /api/internal/artifacts/:id — update artifact
  app.openapi(updateArtifactInternalRoute, async (c) => {
    requireInternalToken(c);
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const [existing] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id));

    if (!existing) {
      return c.json({ message: "Artifact not found" }, 404);
    }

    const now = new Date().toISOString();

    await db
      .update(artifacts)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.previewUrl !== undefined && { previewUrl: input.previewUrl }),
        ...(input.deployTarget !== undefined && {
          deployTarget: input.deployTarget,
        }),
        ...(input.linesOfCode !== undefined && {
          linesOfCode: input.linesOfCode,
        }),
        ...(input.fileCount !== undefined && { fileCount: input.fileCount }),
        ...(input.durationMs !== undefined && { durationMs: input.durationMs }),
        ...(input.metadata !== undefined && {
          metadata: JSON.stringify(input.metadata),
        }),
        updatedAt: now,
      })
      .where(eq(artifacts.id, id));

    const [updated] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id));

    if (!updated) {
      throw ServiceError.from("artifact-routes", {
        code: "artifact_update_failed",
        artifact_id: id,
      });
    }

    return c.json(formatArtifact(updated), 200);
  });
}

// ============================================================
// User routes (after auth middleware)
// ============================================================

const listArtifactsRoute = createRoute({
  method: "get",
  path: "/api/v1/artifacts",
  tags: ["Artifacts"],
  request: {
    query: z.object({
      botId: z.string().optional(),
      sessionKey: z.string().optional(),
      source: z.string().optional(),
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: artifactListResponseSchema },
      },
      description: "Artifact list",
    },
  },
});

const artifactStatsRoute = createRoute({
  method: "get",
  path: "/api/v1/artifacts/stats",
  tags: ["Artifacts"],
  responses: {
    200: {
      content: {
        "application/json": { schema: artifactStatsResponseSchema },
      },
      description: "Artifact statistics",
    },
  },
});

const getArtifactRoute = createRoute({
  method: "get",
  path: "/api/v1/artifacts/{id}",
  tags: ["Artifacts"],
  request: {
    params: artifactIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: artifactResponseSchema } },
      description: "Artifact details",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Artifact not found",
    },
  },
});

const deleteArtifactRoute = createRoute({
  method: "delete",
  path: "/api/v1/artifacts/{id}",
  tags: ["Artifacts"],
  request: {
    params: artifactIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
      description: "Artifact deleted",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Artifact not found",
    },
  },
});

export function registerArtifactRoutes(app: OpenAPIHono<AppBindings>) {
  // Helper: get all botIds belonging to the current user
  async function getUserBotIds(userId: string): Promise<string[]> {
    const userBots = await db
      .select({ id: bots.id })
      .from(bots)
      .where(eq(bots.userId, userId));
    return userBots.map((b) => b.id);
  }

  // GET /v1/artifacts — list with filters
  app.openapi(listArtifactsRoute, async (c) => {
    const userId = c.get("userId");
    const query = c.req.valid("query");
    const { limit, offset } = query;

    const botIds = await getUserBotIds(userId);
    if (botIds.length === 0) {
      return c.json({ artifacts: [], total: 0, limit, offset }, 200);
    }

    // If botId filter specified, verify ownership
    if (query.botId && !botIds.includes(query.botId)) {
      return c.json({ artifacts: [], total: 0, limit, offset }, 200);
    }

    const targetBotIds = query.botId ? [query.botId] : botIds;

    const conditions = [inArray(artifacts.botId, targetBotIds)];
    if (query.sessionKey) {
      conditions.push(eq(artifacts.sessionKey, query.sessionKey));
    }
    if (query.source) {
      conditions.push(eq(artifacts.source, query.source));
    }
    if (query.status) {
      conditions.push(eq(artifacts.status, query.status));
    }

    const whereClause = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(artifacts)
      .where(whereClause);

    const rows = await db
      .select()
      .from(artifacts)
      .where(whereClause)
      .orderBy(desc(artifacts.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json(
      {
        artifacts: rows.map(formatArtifact),
        total: countResult?.count ?? 0,
        limit,
        offset,
      },
      200,
    );
  });

  // GET /v1/artifacts/stats — aggregate stats (must be before :id)
  app.openapi(artifactStatsRoute, async (c) => {
    const userId = c.get("userId");
    const botIds = await getUserBotIds(userId);

    if (botIds.length === 0) {
      return c.json(
        {
          totalArtifacts: 0,
          liveCount: 0,
          buildingCount: 0,
          failedCount: 0,
          codingCount: 0,
          contentCount: 0,
          totalLinesOfCode: 0,
        },
        200,
      );
    }

    const [stats] = await db
      .select({
        totalArtifacts: sql<number>`count(*)::int`,
        liveCount: sql<number>`count(*) filter (where status = 'live')::int`,
        buildingCount: sql<number>`count(*) filter (where status = 'building')::int`,
        failedCount: sql<number>`count(*) filter (where status = 'failed')::int`,
        codingCount: sql<number>`count(*) filter (where source = 'coding')::int`,
        contentCount: sql<number>`count(*) filter (where source = 'content')::int`,
        totalLinesOfCode: sql<number>`coalesce(sum(lines_of_code), 0)::int`,
      })
      .from(artifacts)
      .where(inArray(artifacts.botId, botIds));

    return c.json(stats, 200);
  });

  // GET /v1/artifacts/:id — single artifact
  app.openapi(getArtifactRoute, async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");

    const [artifact] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id));

    if (!artifact) {
      return c.json({ message: "Artifact not found" }, 404);
    }

    // Verify ownership via bot
    const [bot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, artifact.botId), eq(bots.userId, userId)));

    if (!bot) {
      return c.json({ message: "Artifact not found" }, 404);
    }

    return c.json(formatArtifact(artifact), 200);
  });

  // DELETE /v1/artifacts/:id — hard delete
  app.openapi(deleteArtifactRoute, async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");

    const [artifact] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, id));

    if (!artifact) {
      return c.json({ message: "Artifact not found" }, 404);
    }

    // Verify ownership via bot
    const [bot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, artifact.botId), eq(bots.userId, userId)));

    if (!bot) {
      return c.json({ message: "Artifact not found" }, 404);
    }

    await db.delete(artifacts).where(eq(artifacts.id, id));

    return c.json({ message: "Artifact deleted" }, 200);
  });
}
