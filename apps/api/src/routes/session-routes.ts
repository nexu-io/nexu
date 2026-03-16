import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  createSessionSchema,
  sessionListResponseSchema,
  sessionResponseSchema,
  updateSessionSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index.js";
import {
  botChannels,
  bots,
  channelCredentials,
  sessionParticipants,
  sessions,
  workspaceMemberships,
} from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
import { BaseError, ServiceError } from "../lib/error.js";
import { buildFeishuBindPromptCard } from "../lib/feishu-claim-card.js";
import {
  getFeishuTenantToken,
  sendFeishuCardMessage,
} from "../lib/feishu-webhook.js";
import { logger } from "../lib/logger.js";
import { Span } from "../lib/trace-decorator.js";
import { track } from "../lib/tracking.js";
import { requireInternalToken } from "../middleware/internal-auth.js";

import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const sessionIdParam = z.object({
  id: z.string(),
});

function normalizeStoredSessionKey(sessionKey: string): string {
  return sessionKey.trim().toLowerCase();
}

/**
 * Fire-and-forget: check if a Feishu session sender is registered.
 * If not, send a claim card DM so they can create a Nexu account.
 */
async function checkFeishuClaim(params: {
  botId: string;
  channelId: string;
  sessionKey: string;
}): Promise<void> {
  try {
    // Find the feishu bot channel for this bot
    const [feishuChannel] = await db
      .select()
      .from(botChannels)
      .where(
        and(
          eq(botChannels.botId, params.botId),
          eq(botChannels.channelType, "feishu"),
          eq(botChannels.status, "connected"),
        ),
      );

    if (!feishuChannel) return;

    // Get credentials
    const creds = await db
      .select({
        credentialType: channelCredentials.credentialType,
        encryptedValue: channelCredentials.encryptedValue,
      })
      .from(channelCredentials)
      .where(eq(channelCredentials.botChannelId, feishuChannel.id));

    const credMap = new Map<string, string>();
    for (const cred of creds) {
      try {
        credMap.set(cred.credentialType, decrypt(cred.encryptedValue));
      } catch {
        // skip unreadable credentials
      }
    }

    const appId = credMap.get("appId");
    const appSecret = credMap.get("appSecret");
    if (!appId || !appSecret) return;

    const workspaceKey = `feishu:${appId}`;
    // Use channelId (chat_id) as the IM user identifier for feishu p2p chats
    const imUserId = params.channelId;

    // Check if this user is already registered
    const [membership] = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceKey, workspaceKey),
          eq(workspaceMemberships.imUserId, imUserId),
        ),
      );

    if (membership) {
      // Already registered — update session nexuUserId
      await db
        .update(sessions)
        .set({ nexuUserId: membership.userId })
        .where(eq(sessions.sessionKey, params.sessionKey));
      return;
    }

    // Not registered — send bind prompt card with OAuth link
    const tenantToken = await getFeishuTenantToken(appId, appSecret);
    if (!tenantToken) return;

    const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
    const bindUrl = `${webUrl}/feishu/bind?ws=${encodeURIComponent(workspaceKey)}&bot=${encodeURIComponent(params.botId)}`;
    const card = buildFeishuBindPromptCard(bindUrl);
    await sendFeishuCardMessage(card, params.channelId, tenantToken);

    logger.info({
      message: "feishu_bind_prompt_sent",
      scope: "session-routes",
      chat_id: params.channelId,
      workspace_key: workspaceKey,
    });
  } catch (err) {
    const unknownError = BaseError.from(err);
    logger.error({
      message: "feishu_claim_check_failed",
      scope: "session-routes",
      channel_id: params.channelId,
      ...unknownError.toJSON(),
    });
  }
}

// --- Helper ---

function formatSession(row: typeof sessions.$inferSelect) {
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
    sessionKey: row.sessionKey,
    channelType: row.channelType ?? null,
    channelId: row.channelId ?? null,
    title: row.title,
    status: row.status ?? "active",
    messageCount: row.messageCount ?? 0,
    lastMessageAt: row.lastMessageAt ?? null,
    metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ============================================================
// Internal routes (before auth middleware)
// ============================================================

const createSessionRoute = createRoute({
  method: "post",
  path: "/api/internal/sessions",
  tags: ["Sessions (Internal)"],
  request: {
    body: {
      content: { "application/json": { schema: createSessionSchema } },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: sessionResponseSchema } },
      description: "Session created or updated",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
  },
});

const updateSessionInternalRoute = createRoute({
  method: "patch",
  path: "/api/internal/sessions/{id}",
  tags: ["Sessions (Internal)"],
  request: {
    params: sessionIdParam,
    body: {
      content: { "application/json": { schema: updateSessionSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: sessionResponseSchema } },
      description: "Session updated",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Session not found",
    },
  },
});

class SessionSyncTraceHandler {
  @Span("api.sessions.sync.discord.fetch_guilds", {
    tags: ([, botChannelId]) => ({
      channel_type: "discord",
      bot_channel_id: botChannelId,
    }),
  })
  async fetchDiscordGuilds(
    botToken: string,
    _botChannelId: string,
  ): Promise<Response> {
    return fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bot ${botToken}` },
    });
  }

  @Span("api.sessions.sync.feishu.fetch_token", {
    tags: ([, , botChannelId]) => ({
      channel_type: "feishu",
      bot_channel_id: botChannelId,
    }),
  })
  async fetchFeishuToken(
    appId: string,
    appSecret: string,
    _botChannelId: string,
  ): Promise<Response> {
    return fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
    );
  }

  @Span("api.sessions.sync.feishu.fetch_chats", {
    tags: ([, botChannelId]) => ({
      channel_type: "feishu",
      bot_channel_id: botChannelId,
    }),
  })
  async fetchFeishuChats(
    url: string,
    _botChannelId: string,
    tenantToken: string,
  ): Promise<Response> {
    return fetch(url, {
      headers: { Authorization: `Bearer ${tenantToken}` },
    });
  }

  @Span("api.sessions.sync.discord", {
    tags: () => ({
      route: "/api/internal/sessions/sync-discord",
      channel_type: "discord",
    }),
  })
  async syncDiscord(c: Context<AppBindings>): Promise<Response> {
    requireInternalToken(c);
    const body = (await c.req.json()) as { poolId?: string };
    const poolId = body.poolId;
    if (!poolId) {
      return c.json({ message: "poolId required" }, 400);
    }

    const poolBots = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.poolId, poolId), eq(bots.status, "active")));

    if (poolBots.length === 0) {
      return c.json({ synced: 0 });
    }

    const botIds = poolBots.map((b) => b.id);
    let totalSynced = 0;

    const discordChannels = await db
      .select()
      .from(botChannels)
      .where(
        and(
          inArray(botChannels.botId, botIds),
          eq(botChannels.channelType, "discord"),
          eq(botChannels.status, "connected"),
        ),
      );

    for (const ch of discordChannels) {
      const [tokenRow] = await db
        .select({ encryptedValue: channelCredentials.encryptedValue })
        .from(channelCredentials)
        .where(
          and(
            eq(channelCredentials.botChannelId, ch.id),
            eq(channelCredentials.credentialType, "botToken"),
          ),
        );

      if (!tokenRow) continue;

      let botToken: string;
      try {
        botToken = decrypt(tokenRow.encryptedValue);
      } catch {
        continue;
      }

      try {
        const guildsResp = await this.fetchDiscordGuilds(botToken, ch.id);

        if (!guildsResp.ok) {
          logger.warn({
            message: "discord_sync_fetch_guilds_failed",
            status: guildsResp.status,
            bot_channel_id: ch.id,
          });
          continue;
        }

        const guilds = (await guildsResp.json()) as Array<{
          id: string;
          name: string;
        }>;

        const now = new Date().toISOString();

        for (const guild of guilds) {
          const sessionKey = normalizeStoredSessionKey(
            `agent:${ch.botId}:discord:channel:${guild.id}`,
          );
          const title = guild.name;

          await db
            .insert(sessions)
            .values({
              id: createId(),
              botId: ch.botId,
              sessionKey,
              channelType: "discord",
              channelId: guild.id,
              title,
              status: "active",
              messageCount: 0,
              lastMessageAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: sessions.sessionKey,
              set: {
                botId: ch.botId,
                channelType: "discord",
                channelId: guild.id,
                title,
                status: "active",
                updatedAt: now,
              },
            });

          totalSynced++;
        }
      } catch (err) {
        const unknownError = BaseError.from(err);
        logger.error({
          message: "discord_sync_fetch_guilds_error",
          scope: "discord_sync_fetch_guilds",
          bot_channel_id: ch.id,
          ...unknownError.toJSON(),
        });
      }
    }

    return c.json({ synced: totalSynced });
  }

  @Span("api.sessions.sync.feishu", {
    tags: () => ({
      route: "/api/internal/sessions/sync-feishu",
      channel_type: "feishu",
    }),
  })
  async syncFeishu(c: Context<AppBindings>): Promise<Response> {
    const body = (await c.req.json()) as { poolId?: string };
    const poolId = body.poolId;
    if (!poolId) {
      return c.json({ message: "poolId required" }, 400);
    }

    const poolBots = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.poolId, poolId), eq(bots.status, "active")));

    if (poolBots.length === 0) {
      return c.json({ synced: 0 });
    }

    const botIds = poolBots.map((b) => b.id);
    let totalSynced = 0;

    const feishuChannels = await db
      .select()
      .from(botChannels)
      .where(
        and(
          inArray(botChannels.botId, botIds),
          eq(botChannels.channelType, "feishu"),
          eq(botChannels.status, "connected"),
        ),
      );

    for (const ch of feishuChannels) {
      const creds = await db
        .select({
          credentialType: channelCredentials.credentialType,
          encryptedValue: channelCredentials.encryptedValue,
        })
        .from(channelCredentials)
        .where(eq(channelCredentials.botChannelId, ch.id));

      const credMap = new Map<string, string>();
      for (const cred of creds) {
        try {
          credMap.set(cred.credentialType, decrypt(cred.encryptedValue));
        } catch {
          // skip unreadable credentials
        }
      }

      const appId = credMap.get("appId");
      const appSecret = credMap.get("appSecret");
      if (!appId || !appSecret) continue;

      try {
        const tokenResp = await this.fetchFeishuToken(appId, appSecret, ch.id);

        if (!tokenResp.ok) {
          logger.warn({
            message: "feishu_sync_token_fetch_failed",
            scope: "feishu_sync",
            status: tokenResp.status,
            bot_channel_id: ch.id,
          });
          continue;
        }

        const tokenData = (await tokenResp.json()) as {
          code: number;
          tenant_access_token?: string;
        };

        if (tokenData.code !== 0 || !tokenData.tenant_access_token) {
          logger.warn({
            message: "feishu_sync_token_error",
            scope: "feishu_sync",
            feishu_code: tokenData.code,
            bot_channel_id: ch.id,
          });
          continue;
        }

        const tenantToken = tokenData.tenant_access_token;
        let pageToken: string | undefined;
        const allChats: Array<{ chat_id: string; name: string }> = [];

        do {
          const url = new URL("https://open.feishu.cn/open-apis/im/v1/chats");
          if (pageToken) {
            url.searchParams.set("page_token", pageToken);
          }

          const chatsResp = await this.fetchFeishuChats(
            url.toString(),
            ch.id,
            tenantToken,
          );

          if (!chatsResp.ok) {
            logger.warn({
              message: "feishu_sync_fetch_chats_failed",
              scope: "feishu_sync",
              status: chatsResp.status,
              bot_channel_id: ch.id,
            });
            break;
          }

          const chatsData = (await chatsResp.json()) as {
            code: number;
            data?: {
              items?: Array<{ chat_id: string; name: string }>;
              page_token?: string;
              has_more?: boolean;
            };
          };

          if (chatsData.code !== 0) {
            logger.warn({
              message: "feishu_sync_chats_api_error",
              scope: "feishu_sync",
              feishu_code: chatsData.code,
              bot_channel_id: ch.id,
            });
            break;
          }

          if (chatsData.data?.items) {
            allChats.push(...chatsData.data.items);
          }

          pageToken = chatsData.data?.has_more
            ? chatsData.data.page_token
            : undefined;
        } while (pageToken);

        const now = new Date().toISOString();

        for (const chat of allChats) {
          const sessionKey = normalizeStoredSessionKey(
            `agent:${ch.botId}:feishu:channel:${chat.chat_id}`,
          );
          const title = chat.name || chat.chat_id;

          await db
            .insert(sessions)
            .values({
              id: createId(),
              botId: ch.botId,
              sessionKey,
              channelType: "feishu",
              channelId: chat.chat_id,
              title,
              status: "active",
              messageCount: 0,
              lastMessageAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: sessions.sessionKey,
              set: {
                botId: ch.botId,
                title,
                updatedAt: now,
              },
            });

          totalSynced++;
        }
      } catch (err) {
        const unknownError = BaseError.from(err);
        logger.error({
          message: "feishu_sync_fetch_chats_error",
          scope: "feishu_sync",
          bot_channel_id: ch.id,
          ...unknownError.toJSON(),
        });
      }
    }

    return c.json({ synced: totalSynced });
  }
}

export function registerSessionInternalRoutes(app: OpenAPIHono<AppBindings>) {
  const syncTraceHandler = new SessionSyncTraceHandler();

  // POST /api/internal/sessions — Gateway sidecar upserts a session
  app.openapi(createSessionRoute, async (c) => {
    requireInternalToken(c);
    const input = c.req.valid("json");

    // Verify botId exists and get owner userId for tracking
    const [bot] = await db
      .select({ id: bots.id, userId: bots.userId })
      .from(bots)
      .where(eq(bots.id, input.botId));

    if (!bot) {
      return c.json({ message: "Bot not found" }, 400);
    }

    const now = new Date().toISOString();
    const id = createId();
    const normalizedSessionKey = normalizeStoredSessionKey(input.sessionKey);

    // Check if session already exists (to distinguish insert vs update)
    const [existing] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.sessionKey, normalizedSessionKey));

    // Upsert on sessionKey
    await db
      .insert(sessions)
      .values({
        id,
        botId: input.botId,
        sessionKey: normalizedSessionKey,
        title: input.title,
        channelType: input.channelType,
        channelId: input.channelId,
        status: input.status ?? "active",
        messageCount: input.messageCount ?? 0,
        lastMessageAt: input.lastMessageAt,
        metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: sessions.sessionKey,
        set: {
          botId: input.botId,
          title: input.title,
          ...(input.channelType !== undefined && {
            channelType: input.channelType,
          }),
          ...(input.channelId !== undefined && {
            channelId: input.channelId,
          }),
          ...(input.status !== undefined && { status: input.status }),
          ...(input.messageCount !== undefined && {
            messageCount: input.messageCount,
          }),
          ...(input.lastMessageAt !== undefined && {
            lastMessageAt: input.lastMessageAt,
          }),
          ...(input.metadata !== undefined && {
            metadata: JSON.stringify(input.metadata),
          }),
          updatedAt: now,
        },
      });

    const [created] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.sessionKey, normalizedSessionKey));

    if (!created) {
      throw ServiceError.from("session-routes", {
        code: "session_upsert_failed",
        session_key: normalizedSessionKey,
        bot_id: input.botId,
      });
    }

    // Track: new session = session_start, every upsert = task_number
    const channelType = created.channelType ?? "unknown";
    if (!existing) {
      track("session_start", bot.userId, { channel_type: channelType });
    }
    track("task_number", bot.userId, { channel_type: channelType });

    // Fire-and-forget: Feishu claim check for new sessions
    if (!existing && channelType === "feishu" && created.channelId) {
      checkFeishuClaim({
        botId: created.botId,
        channelId: created.channelId,
        sessionKey: created.sessionKey,
      }).catch(() => {
        // Silently ignore — claim check is best-effort
      });
    }

    return c.json(formatSession(created), 201);
  });

  // PATCH /api/internal/sessions/:id — update session
  app.openapi(updateSessionInternalRoute, async (c) => {
    requireInternalToken(c);
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");

    const [existing] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id));

    if (!existing) {
      return c.json({ message: "Session not found" }, 404);
    }

    const now = new Date().toISOString();

    await db
      .update(sessions)
      .set({
        ...(input.title !== undefined && { title: input.title }),
        ...(input.status !== undefined && { status: input.status }),
        ...(input.messageCount !== undefined && {
          messageCount: input.messageCount,
        }),
        ...(input.lastMessageAt !== undefined && {
          lastMessageAt: input.lastMessageAt,
        }),
        ...(input.metadata !== undefined && {
          metadata: JSON.stringify(input.metadata),
        }),
        updatedAt: now,
      })
      .where(eq(sessions.id, id));

    const [updated] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id));

    if (!updated) {
      throw ServiceError.from("session-routes", {
        code: "session_update_failed",
        session_id: id,
      });
    }

    return c.json(formatSession(updated), 200);
  });

  // POST /api/internal/sessions/sync-discord — Sync Discord sessions via Discord REST API
  app.post("/api/internal/sessions/sync-discord", async (c) => {
    return syncTraceHandler.syncDiscord(c);
  });

  // POST /api/internal/sessions/sync-feishu — Sync Feishu sessions via Feishu REST API
  app.post("/api/internal/sessions/sync-feishu", async (c) => {
    return syncTraceHandler.syncFeishu(c);
  });
}

// ============================================================
// Access control helper
// ============================================================

function buildAccessClause(
  table: {
    botId: typeof sessions.botId;
    nexuUserId: typeof sessions.nexuUserId;
    sessionKey: typeof sessions.sessionKey;
  },
  userId: string,
  botIds: string[],
  queryBotId?: string,
) {
  // Sessions where the user is a participant (group channels)
  const participantSessions = db
    .select({ sessionKey: sessionParticipants.sessionKey })
    .from(sessionParticipants)
    .where(eq(sessionParticipants.nexuUserId, userId));

  const userAccess = or(
    eq(table.nexuUserId, userId),
    inArray(table.sessionKey, participantSessions),
  );

  if (queryBotId) {
    return botIds.includes(queryBotId)
      ? eq(table.botId, queryBotId)
      : and(userAccess, eq(table.botId, queryBotId));
  }
  return botIds.length > 0
    ? or(inArray(table.botId, botIds), userAccess)
    : userAccess;
}

// ============================================================
// User routes (after auth middleware)
// ============================================================

const listSessionsRoute = createRoute({
  method: "get",
  path: "/api/v1/sessions",
  tags: ["Sessions"],
  request: {
    query: z.object({
      botId: z.string().optional(),
      channelType: z.string().optional(),
      status: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: sessionListResponseSchema },
      },
      description: "Session list",
    },
  },
});

const getSessionRoute = createRoute({
  method: "get",
  path: "/api/v1/sessions/{id}",
  tags: ["Sessions"],
  request: {
    params: sessionIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: sessionResponseSchema } },
      description: "Session details",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Session not found",
    },
  },
});

export function registerSessionRoutes(app: OpenAPIHono<AppBindings>) {
  async function getUserBotIds(userId: string): Promise<string[]> {
    const userBots = await db
      .select({ id: bots.id })
      .from(bots)
      .where(eq(bots.userId, userId));
    return userBots.map((b) => b.id);
  }

  // GET /v1/sessions — list with filters
  app.openapi(listSessionsRoute, async (c) => {
    const userId = c.get("userId");
    const query = c.req.valid("query");
    const { limit, offset } = query;

    const botIds = await getUserBotIds(userId);

    const accessClause = buildAccessClause(
      sessions,
      userId,
      botIds,
      query.botId,
    );

    const conditions = [accessClause];
    if (query.channelType) {
      conditions.push(eq(sessions.channelType, query.channelType));
    }
    if (query.status) {
      conditions.push(eq(sessions.status, query.status));
    }

    const whereClause = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(sessions)
      .where(whereClause);

    const rows = await db
      .select()
      .from(sessions)
      .where(whereClause)
      .orderBy(
        sql`${sessions.lastMessageAt} DESC NULLS LAST`,
        desc(sessions.createdAt),
      )
      .limit(limit)
      .offset(offset);

    return c.json(
      {
        sessions: rows.map(formatSession),
        total: countResult?.count ?? 0,
        limit,
        offset,
      },
      200,
    );
  });

  // GET /v1/sessions/:id — single session
  app.openapi(getSessionRoute, async (c) => {
    const userId = c.get("userId");
    const { id } = c.req.valid("param");

    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, id));

    if (!session) {
      return c.json({ message: "Session not found" }, 404);
    }

    if (session.nexuUserId === userId) {
      return c.json(formatSession(session), 200);
    }

    // Verify ownership via bot (legacy/owned-bot access)
    const [bot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, session.botId), eq(bots.userId, userId)));

    if (!bot) {
      return c.json({ message: "Session not found" }, 404);
    }

    return c.json(formatSession(session), 200);
  });
}
