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
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { artifacts, bots, sessions } from "../db/schema/index.js";
import { ServiceError } from "../lib/error.js";
import { requireSkillToken } from "../middleware/internal-auth.js";
import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const artifactIdParam = z.object({
  id: z.string(),
});

function normalizeSessionKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePreviewUrl(value: string): string {
  return value.trim();
}

async function resolveArtifactSessionKey(input: {
  botId: string;
  sessionKey?: string;
  chatId?: string;
  threadId?: string;
  channelType?: string;
}): Promise<{ sessionKey?: string; error?: string }> {
  const rawSessionKey = input.sessionKey?.trim();
  const rawChatId = input.chatId?.trim();
  const rawThreadId = input.threadId?.trim();
  const normalizedThreadId = rawThreadId
    ? rawThreadId.toLowerCase()
    : undefined;

  if (rawSessionKey) {
    if (!rawSessionKey.toLowerCase().startsWith("agent:")) {
      return { error: "sessionKey must start with agent:" };
    }
    return { sessionKey: normalizeSessionKey(rawSessionKey) };
  }

  if (normalizedThreadId && !rawChatId) {
    return { error: "threadId requires chatId" };
  }

  if (!rawChatId) {
    return { error: "sessionKey or chatId is required" };
  }

  const normalizedBotId = input.botId.trim().toLowerCase();
  if (rawChatId.startsWith("user:")) {
    const userId = rawChatId.slice("user:".length).trim().toLowerCase();
    const stripThread = (key: string) => key.replace(/:thread:.*$/, "");

    // With dmScope: "per-channel-peer", DM session keys are
    //   agent:{botId}:{channel}:direct:{userId}
    // Try DB lookup first, then fall back to legacy agent:{botId}:main.
    if (userId) {
      const dmConditions = [
        eq(sessions.botId, input.botId),
        sql`lower(${sessions.sessionKey}) LIKE ${`%:direct:${userId}`}`,
      ];
      const normalizedChannelType = input.channelType?.trim().toLowerCase();
      if (normalizedChannelType) {
        dmConditions.push(eq(sessions.channelType, normalizedChannelType));
      }
      const dmRows = await db
        .select({ sessionKey: sessions.sessionKey })
        .from(sessions)
        .where(and(...dmConditions))
        .orderBy(desc(sessions.lastMessageAt), desc(sessions.createdAt))
        .limit(1);

      if (dmRows[0]) {
        const baseKey = stripThread(normalizeSessionKey(dmRows[0].sessionKey));
        return {
          sessionKey: normalizedThreadId
            ? `${baseKey}:thread:${normalizedThreadId}`
            : baseKey,
        };
      }
    }

    // Fallback: legacy dmScope "main"
    const base = `agent:${normalizedBotId}:main`;
    return {
      sessionKey: normalizedThreadId
        ? `${base}:thread:${normalizedThreadId}`
        : base,
    };
  }

  if (!rawChatId.startsWith("channel:")) {
    return { error: "chatId must start with user: or channel:" };
  }

  const channelId = rawChatId.slice("channel:".length).trim();
  if (!channelId) {
    return { error: "chatId channel id is required" };
  }

  const conditions = [
    eq(sessions.botId, input.botId),
    sql`lower(${sessions.channelId}) = ${channelId.toLowerCase()}`,
  ];
  const normalizedChannelType = input.channelType?.trim().toLowerCase();
  if (normalizedChannelType) {
    conditions.push(eq(sessions.channelType, normalizedChannelType));
  }

  const rows = await db
    .select({
      sessionKey: sessions.sessionKey,
      channelType: sessions.channelType,
    })
    .from(sessions)
    .where(and(...conditions))
    .orderBy(desc(sessions.lastMessageAt), desc(sessions.createdAt));

  if (rows.length === 0) {
    return { error: "No matching session found for chatId" };
  }

  // Filter to only valid agent:*:channel:* session keys.
  // Prod data may contain legacy formats (e.g. "slack_T09CNAG_C09CNAG")
  // or truncated keys (e.g. "agent:bot:slack" without :channel:).
  const normalizedChannelId = channelId.toLowerCase();
  const validRows = rows.filter((row) => {
    const key = normalizeSessionKey(row.sessionKey);
    return (
      key.startsWith("agent:") &&
      key.includes(`:channel:${normalizedChannelId}`)
    );
  });

  if (validRows.length === 0) {
    return { error: "No matching session found for chatId" };
  }

  // Strip thread suffixes to get base channel keys, then deduplicate
  const stripThread = (key: string) => key.replace(/:thread:.*$/, "");
  const uniqueBaseKeys = new Set(
    validRows.map((row) => stripThread(normalizeSessionKey(row.sessionKey))),
  );
  if (uniqueBaseKeys.size !== 1) {
    return { error: "Ambiguous session resolution for chatId" };
  }

  const firstValid = validRows[0];
  if (!firstValid) {
    return { error: "No matching session found for chatId" };
  }
  const baseKey = stripThread(normalizeSessionKey(firstValid.sessionKey));
  if (!baseKey) {
    return { error: "No matching session found for chatId" };
  }

  return {
    sessionKey: normalizedThreadId
      ? `${baseKey}:thread:${normalizedThreadId}`
      : baseKey,
  };
}

async function findArtifactBySessionPreview(input: {
  sessionKey?: string;
  previewUrl?: string;
  excludeId?: string;
}) {
  const sessionKey = input.sessionKey?.trim();
  const previewUrl = input.previewUrl?.trim();
  if (!sessionKey || !previewUrl) {
    return undefined;
  }

  const conditions = [
    eq(artifacts.sessionKey, sessionKey),
    eq(artifacts.previewUrl, previewUrl),
  ];
  if (input.excludeId) {
    conditions.push(sql`${artifacts.id} <> ${input.excludeId}`);
  }

  const rows = await db
    .select()
    .from(artifacts)
    .where(and(...conditions))
    .orderBy(desc(artifacts.updatedAt), desc(artifacts.createdAt));

  return rows[0];
}

// TODO: Optimize by passing nexuUserId from session upsert instead of a separate query.
// Acceptable for now — hits an indexed column and artifact creation is less frequent than messages.
async function resolveArtifactNexuUserId(input: {
  botId: string;
  sessionKey?: string;
}): Promise<string | undefined> {
  const sessionKey = input.sessionKey?.trim();
  if (!sessionKey) {
    return undefined;
  }
  const normalized = normalizeSessionKey(sessionKey);
  const [row] = await db
    .select({ nexuUserId: sessions.nexuUserId })
    .from(sessions)
    .where(
      and(
        eq(sessions.botId, input.botId),
        sql`lower(${sessions.sessionKey}) = ${normalized}`,
      ),
    )
    .orderBy(desc(sessions.updatedAt));
  return row?.nexuUserId ?? undefined;
}

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
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Preview URL already in use by another session",
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

const checkArtifactDomainRoute = createRoute({
  method: "post",
  path: "/api/internal/artifacts/check-domain",
  tags: ["Artifacts (Internal)"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            botId: z.string(),
            sessionKey: z.string().optional(),
            chatId: z.string().optional(),
            threadId: z.string().optional(),
            channelType: z.string().optional(),
            previewUrl: z.string().url(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            available: z.boolean(),
            sessionKey: z.string().nullable(),
            existingArtifactId: z.string().nullable(),
            existingSessionKey: z.string().nullable(),
          }),
        },
      },
      description: "Domain availability result",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Domain already in use by another session",
    },
  },
});

export function registerArtifactInternalRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(checkArtifactDomainRoute, async (c) => {
    requireSkillToken(c);
    const input = c.req.valid("json");

    const [bot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(eq(bots.id, input.botId));

    if (!bot) {
      return c.json({ message: "Bot not found" }, 400);
    }

    const resolved = await resolveArtifactSessionKey({
      botId: input.botId,
      sessionKey: input.sessionKey,
      chatId: input.chatId,
      threadId: input.threadId,
      channelType: input.channelType,
    });
    if (resolved.error) {
      return c.json({ message: resolved.error }, 400);
    }

    const normalizedPreviewUrl = normalizePreviewUrl(input.previewUrl);
    const existing = await db
      .select({
        id: artifacts.id,
        sessionKey: artifacts.sessionKey,
      })
      .from(artifacts)
      .where(eq(artifacts.previewUrl, normalizedPreviewUrl))
      .orderBy(desc(artifacts.updatedAt), desc(artifacts.createdAt));

    const owner = existing[0];
    if (!owner) {
      return c.json(
        {
          available: true,
          sessionKey: resolved.sessionKey ?? null,
          existingArtifactId: null,
          existingSessionKey: null,
        },
        200,
      );
    }

    const normalizedOwnerKey = owner.sessionKey
      ? normalizeSessionKey(owner.sessionKey)
      : null;
    const normalizedResolvedKey = resolved.sessionKey
      ? normalizeSessionKey(resolved.sessionKey)
      : null;
    if (normalizedOwnerKey && normalizedOwnerKey === normalizedResolvedKey) {
      return c.json(
        {
          available: true,
          sessionKey: normalizedResolvedKey,
          existingArtifactId: owner.id,
          existingSessionKey: normalizedOwnerKey,
        },
        200,
      );
    }

    return c.json(
      {
        message: "previewUrl is already in use by another session",
      },
      409,
    );
  });

  // POST /api/internal/artifacts — Skill creates an artifact
  app.openapi(createArtifactRoute, async (c) => {
    requireSkillToken(c);
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
    const resolved = await resolveArtifactSessionKey({
      botId: input.botId,
      sessionKey: input.sessionKey,
      chatId: input.chatId,
      threadId: input.threadId,
      channelType: input.channelType,
    });
    if (resolved.error) {
      return c.json({ message: resolved.error }, 400);
    }

    const normalizedPreviewUrl = input.previewUrl
      ? normalizePreviewUrl(input.previewUrl)
      : undefined;
    if (normalizedPreviewUrl) {
      const existingPreviewOwner = await db
        .select({
          id: artifacts.id,
          sessionKey: artifacts.sessionKey,
        })
        .from(artifacts)
        .where(eq(artifacts.previewUrl, normalizedPreviewUrl))
        .orderBy(desc(artifacts.updatedAt), desc(artifacts.createdAt));

      const previewOwner = existingPreviewOwner[0];
      const previewOwnerKey = previewOwner?.sessionKey
        ? normalizeSessionKey(previewOwner.sessionKey)
        : undefined;
      if (
        previewOwnerKey &&
        resolved.sessionKey &&
        previewOwnerKey !== normalizeSessionKey(resolved.sessionKey)
      ) {
        return c.json(
          { message: "previewUrl is already in use by another session" },
          409,
        );
      }
    }
    const duplicate = await findArtifactBySessionPreview({
      sessionKey: resolved.sessionKey,
      previewUrl: normalizedPreviewUrl,
    });
    const resolvedNexuUserId = await resolveArtifactNexuUserId({
      botId: input.botId,
      sessionKey: resolved.sessionKey,
    });

    if (duplicate) {
      await db
        .update(artifacts)
        .set({
          botId: input.botId,
          title: input.title,
          sessionKey: resolved.sessionKey,
          channelType: input.channelType,
          channelId: input.channelId,
          artifactType: input.artifactType,
          source: input.source,
          contentType: input.contentType,
          status: input.status ?? duplicate.status ?? "building",
          previewUrl: normalizedPreviewUrl,
          deployTarget: input.deployTarget,
          linesOfCode: input.linesOfCode,
          fileCount: input.fileCount,
          durationMs: input.durationMs,
          metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
          ...(resolvedNexuUserId !== undefined && {
            nexuUserId: resolvedNexuUserId,
          }),
          updatedAt: now,
        })
        .where(eq(artifacts.id, duplicate.id));
    } else {
      await db.insert(artifacts).values({
        id,
        botId: input.botId,
        title: input.title,
        sessionKey: resolved.sessionKey,
        nexuUserId: resolvedNexuUserId,
        channelType: input.channelType,
        channelId: input.channelId,
        artifactType: input.artifactType,
        source: input.source,
        contentType: input.contentType,
        status: input.status ?? "building",
        previewUrl: normalizedPreviewUrl,
        deployTarget: input.deployTarget,
        linesOfCode: input.linesOfCode,
        fileCount: input.fileCount,
        durationMs: input.durationMs,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        createdAt: now,
        updatedAt: now,
      });
    }

    const targetId = duplicate?.id ?? id;
    const [created] = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.id, targetId));

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
    requireSkillToken(c);
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
// Access control helper
// ============================================================

function buildAccessClause(
  table: {
    botId: typeof artifacts.botId;
    nexuUserId: typeof artifacts.nexuUserId;
  },
  userId: string,
  botIds: string[],
  queryBotId?: string,
) {
  if (queryBotId) {
    return botIds.includes(queryBotId)
      ? eq(table.botId, queryBotId)
      : and(eq(table.nexuUserId, userId), eq(table.botId, queryBotId));
  }
  return botIds.length > 0
    ? or(inArray(table.botId, botIds), eq(table.nexuUserId, userId))
    : eq(table.nexuUserId, userId);
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
    const accessClause = buildAccessClause(
      artifacts,
      userId,
      botIds,
      query.botId,
    );

    const conditions = [accessClause];
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

    const accessClause = buildAccessClause(artifacts, userId, botIds);

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
      .where(accessClause);

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

    if (artifact.nexuUserId === userId) {
      return c.json(formatArtifact(artifact), 200);
    }

    // Verify ownership via bot (legacy/owned-bot access)
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

    if (artifact.nexuUserId === userId) {
      await db.delete(artifacts).where(eq(artifacts.id, id));
      return c.json({ message: "Artifact deleted" }, 200);
    }

    // Verify ownership via bot (legacy/owned-bot access)
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
