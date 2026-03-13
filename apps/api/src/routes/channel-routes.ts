import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  botQuotaResponseSchema,
  channelListResponseSchema,
  channelResponseSchema,
  connectDiscordSchema,
  connectFeishuSchema,
  connectSlackSchema,
  slackOAuthUrlResponseSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, lt, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  botChannels,
  bots,
  channelCredentials,
  oauthStates,
  webhookRoutes,
} from "../db/schema/index.js";
import { findOrCreateDefaultBot } from "../lib/bot-helpers.js";
import { checkBotQuota } from "../lib/bot-quota.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { BaseError, ServiceError } from "../lib/error.js";
import { getFeishuTenantToken } from "../lib/feishu-webhook.js";
import { logger } from "../lib/logger.js";
import { Span } from "../lib/trace-decorator.js";
import { publishPoolConfigSnapshot } from "../services/runtime/pool-config-service.js";

import type { AppBindings } from "../types.js";

// ---------------------------------------------------------------------------
// Shared helpers & schemas
// ---------------------------------------------------------------------------

const errorResponseSchema = z.object({
  message: z.string(),
});

const channelIdParam = z.object({
  channelId: z.string(),
});

interface SlackOAuthV2Response {
  ok: boolean;
  error?: string;
  access_token: string;
  token_type: "bot";
  scope: string;
  bot_user_id: string;
  app_id: string;
  team: { id: string; name: string };
  enterprise?: { id: string; name: string } | null;
  authed_user: { id: string };
}

class ChannelSpanHandler {
  @Span("api.channels.snapshot.publish", {
    tags: ([poolId]) => ({ channel_type: "multi", pool_id: poolId }),
  })
  async publishSnapshot(poolId: string): Promise<void> {
    await publishPoolConfigSnapshot(db, poolId);
  }

  @Span("api.channels.slack.oauth_state.create", {
    tags: () => ({ channel_type: "slack" }),
  })
  async createSlackOauthState(
    userId: string,
    nonce: string,
    expiresAt: string,
    returnTo: string | undefined,
  ): Promise<void> {
    await db.insert(oauthStates).values({
      id: createId(),
      state: nonce,
      userId,
      expiresAt,
      returnTo,
    });
  }

  @Span("api.channels.slack.auth_test", {
    tags: () => ({ channel_type: "slack" }),
  })
  async slackAuthTest(botToken: string): Promise<Response> {
    return fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });
  }

  @Span("api.channels.slack.bots_info", {
    tags: () => ({ channel_type: "slack" }),
  })
  async slackBotsInfo(botId: string, botToken: string): Promise<Response> {
    return fetch(`https://slack.com/api/bots.info?bot=${botId}`, {
      headers: { Authorization: `Bearer ${botToken}` },
    });
  }

  @Span("api.channels.bot.resolve_default", {
    tags: () => ({ channel_type: "slack" }),
  })
  async resolveDefaultBot(userId: string) {
    return findOrCreateDefaultBot(userId);
  }
}

const channelSpanHandler = new ChannelSpanHandler();

function formatChannel(
  ch: typeof botChannels.$inferSelect,
): z.infer<typeof channelResponseSchema> {
  let config: Record<string, unknown> = {};
  if (ch.channelConfig) {
    try {
      config =
        typeof ch.channelConfig === "string"
          ? JSON.parse(ch.channelConfig)
          : (ch.channelConfig as Record<string, unknown>);
    } catch {
      config = {};
    }
  }
  return {
    id: ch.id,
    botId: ch.botId,
    channelType: ch.channelType as "slack" | "discord" | "feishu",
    accountId: ch.accountId,
    status: (ch.status ?? "pending") as
      | "pending"
      | "connected"
      | "disconnected"
      | "error",
    teamName: (config.teamName as string) ?? null,
    appId: (config.appId as string) ?? null,
    botUserId: (config.botUserId as string) ?? null,
    createdAt: ch.createdAt,
    updatedAt: ch.updatedAt,
  };
}

async function publishSnapshotSafely(
  poolId: string | null | undefined,
  botId: string,
): Promise<void> {
  if (!poolId) {
    return;
  }

  try {
    await channelSpanHandler.publishSnapshot(poolId);
  } catch (error) {
    const unknownError = BaseError.from(error);
    logger.error({
      message: "channels_publish_snapshot_failed",
      scope: "channels_publish_snapshot",
      pool_id: poolId,
      bot_id: botId,
      ...unknownError.toJSON(),
    });
  }
}

/** Build the fixed redirect URI used in both the authorize URL and the token exchange. */
function getSlackRedirectUri(): string {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return `${base}/api/oauth/slack/callback`;
}

/** Scopes required for a messaging bot. */
const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "assistant:write",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "files:read",
  "files:write",
  "reactions:write",
  "users:read",
  "users.profile:read",
].join(",");

// ---------------------------------------------------------------------------
// OpenAPI route definitions (user-scoped, no botId param)
// ---------------------------------------------------------------------------

const slackRedirectUriRoute = createRoute({
  method: "get",
  path: "/api/v1/channels/slack/redirect-uri",
  tags: ["Channels"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ redirectUri: z.string() }),
        },
      },
      description: "The OAuth redirect URI configured on this server",
    },
  },
});

const slackOAuthUrlRoute = createRoute({
  method: "get",
  path: "/api/v1/channels/slack/oauth-url",
  tags: ["Channels"],
  request: {
    query: z.object({
      returnTo: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: slackOAuthUrlResponseSchema },
      },
      description: "Slack OAuth authorization URL",
    },
    500: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Slack OAuth not configured",
    },
  },
});

const connectSlackRoute = createRoute({
  method: "post",
  path: "/api/v1/channels/slack/connect",
  tags: ["Channels"],
  request: {
    body: { content: { "application/json": { schema: connectSlackSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: channelResponseSchema } },
      description: "Slack channel connected",
    },
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Slack already connected",
    },
  },
});

const listChannelsRoute = createRoute({
  method: "get",
  path: "/api/v1/channels",
  tags: ["Channels"],
  responses: {
    200: {
      content: { "application/json": { schema: channelListResponseSchema } },
      description: "Channel list",
    },
  },
});

const disconnectChannelRoute = createRoute({
  method: "delete",
  path: "/api/v1/channels/{channelId}",
  tags: ["Channels"],
  request: {
    params: channelIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ success: z.boolean() }) },
      },
      description: "Channel disconnected",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Not found",
    },
  },
});

const connectDiscordRoute = createRoute({
  method: "post",
  path: "/api/v1/channels/discord/connect",
  tags: ["Channels"],
  request: {
    body: {
      content: { "application/json": { schema: connectDiscordSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: channelResponseSchema } },
      description: "Discord channel connected",
    },
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Discord already connected",
    },
  },
});

const connectFeishuRoute = createRoute({
  method: "post",
  path: "/api/v1/channels/feishu/connect",
  tags: ["Channels"],
  request: {
    body: {
      content: { "application/json": { schema: connectFeishuSchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: channelResponseSchema } },
      description: "Feishu channel connected",
    },
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid credentials or already connected",
    },
  },
});

const channelStatusRoute = createRoute({
  method: "get",
  path: "/api/v1/channels/{channelId}/status",
  tags: ["Channels"],
  request: {
    params: channelIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: channelResponseSchema } },
      description: "Channel status",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Not found",
    },
  },
});

const botQuotaRoute = createRoute({
  method: "get",
  path: "/api/v1/bot-quota",
  tags: ["Channels"],
  responses: {
    200: {
      content: {
        "application/json": { schema: botQuotaResponseSchema },
      },
      description: "Bot creation quota status",
    },
  },
});

// ---------------------------------------------------------------------------
// Authenticated channel routes (under /v1/*)
// ---------------------------------------------------------------------------

export function registerChannelRoutes(app: OpenAPIHono<AppBindings>) {
  // -- Bot quota check --
  app.openapi(botQuotaRoute, async (c) => {
    const quota = await checkBotQuota();
    return c.json(quota, 200);
  });
  // -- Slack redirect URI (lightweight, no state creation) --
  app.openapi(slackRedirectUriRoute, async (c) => {
    return c.json({ redirectUri: getSlackRedirectUri() }, 200);
  });

  // -- Slack OAuth URL generation (authenticated, no botId needed) --
  app.openapi(slackOAuthUrlRoute, async (c) => {
    const userId = c.get("userId");

    const clientId = process.env.SLACK_CLIENT_ID;
    if (!clientId) {
      return c.json(
        { message: "Slack OAuth is not configured on this server" },
        500,
      );
    }

    // Generate CSRF state token (10 min TTL) — botId is null
    const nonce = createId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const returnTo = c.req.query("returnTo");

    await channelSpanHandler.createSlackOauthState(
      userId,
      nonce,
      expiresAt,
      returnTo,
    );

    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("scope", SLACK_BOT_SCOPES);
    url.searchParams.set("redirect_uri", getSlackRedirectUri());
    url.searchParams.set("state", nonce);

    return c.json(
      { url: url.toString(), redirectUri: getSlackRedirectUri() },
      200,
    );
  });

  // -- Manual Slack connect (authenticated) --
  app.openapi(connectSlackRoute, async (c) => {
    const userId = c.get("userId");
    const input = c.req.valid("json");

    // Auto-resolve teamId/appId from bot token via auth.test
    let teamId = input.teamId;
    let appId = input.appId;
    let teamName = input.teamName;
    let botUserId: string | undefined;

    if (!teamId || !appId) {
      const authResp = await channelSpanHandler.slackAuthTest(input.botToken);
      const authData = (await authResp.json()) as {
        ok: boolean;
        team_id?: string;
        team?: string;
        bot_id?: string;
        user_id?: string;
        error?: string;
      };
      if (!authData.ok) {
        return c.json(
          {
            message: `Invalid bot token: ${authData.error ?? "auth.test failed"}`,
          },
          409,
        );
      }
      if (!authData.team_id) {
        return c.json(
          { message: "Could not resolve team_id from bot token" },
          409,
        );
      }
      teamId = teamId || authData.team_id;
      teamName = teamName || authData.team || undefined;
      botUserId = authData.user_id;

      // auth.test returns bot_id but not app_id; use bots.info to resolve the real app_id
      // (app_id must match api_app_id in Slack event payloads for webhook route lookup)
      if (!appId && authData.bot_id) {
        const botsResp = await channelSpanHandler.slackBotsInfo(
          authData.bot_id,
          input.botToken,
        );
        const botsData = (await botsResp.json()) as {
          ok: boolean;
          bot?: { app_id?: string };
        };
        if (botsData.ok && botsData.bot?.app_id) {
          appId = botsData.bot.app_id;
        }
      }

      if (!appId) {
        return c.json(
          {
            message:
              "Could not resolve app_id from bot token. Please provide it manually from your Slack App's Basic Information page.",
          },
          409,
        );
      }
    }

    const bot = await channelSpanHandler.resolveDefaultBot(userId);
    const botId = bot.id;

    const accountId = `slack-${appId}-${teamId}`;
    const oldAccountId = `slack-${appId}`;
    const slackExternalId = `${teamId}:${appId}`;

    // Check if this Slack app is already connected (by externalId)
    const [globalExisting] = await db
      .select()
      .from(webhookRoutes)
      .where(
        and(
          eq(webhookRoutes.channelType, "slack"),
          eq(webhookRoutes.externalId, slackExternalId),
        ),
      );

    if (globalExisting && globalExisting.botId !== botId) {
      return c.json(
        { message: "This Slack app is already connected to another bot" },
        409,
      );
    }

    const now = new Date().toISOString();
    let channelId: string;

    // Clean up any stale Slack channels for this bot (e.g. old records with wrong accountId)
    const existingChannels = await db
      .select()
      .from(botChannels)
      .where(
        and(eq(botChannels.botId, botId), eq(botChannels.channelType, "slack")),
      );

    const existingChannel = existingChannels.find(
      (ch) => ch.accountId === accountId || ch.accountId === oldAccountId,
    );

    if (existingChannel || globalExisting) {
      // Reconnection — reuse existing channel or the one referenced by the webhook route
      channelId = (existingChannel?.id ??
        globalExisting?.botChannelId) as string;

      await db
        .update(botChannels)
        .set({
          status: "connected",
          accountId,
          channelConfig: JSON.stringify({
            teamId,
            teamName: teamName ?? null,
            appId,
            botUserId: botUserId ?? null,
          }),
          updatedAt: now,
        })
        .where(eq(botChannels.id, channelId));

      // Replace credentials
      await db
        .delete(channelCredentials)
        .where(eq(channelCredentials.botChannelId, channelId));

      await db.insert(channelCredentials).values([
        {
          id: createId(),
          botChannelId: channelId,
          credentialType: "botToken",
          encryptedValue: encrypt(input.botToken),
          createdAt: now,
        },
        {
          id: createId(),
          botChannelId: channelId,
          credentialType: "signingSecret",
          encryptedValue: encrypt(input.signingSecret),
          createdAt: now,
        },
      ]);

      // Update or create webhook route with correct externalId
      if (globalExisting) {
        await db
          .update(webhookRoutes)
          .set({
            externalId: slackExternalId,
            poolId: bot.poolId ?? globalExisting.poolId,
            botChannelId: channelId,
            botId,
            accountId,
            updatedAt: now,
          })
          .where(eq(webhookRoutes.id, globalExisting.id));
      } else if (bot.poolId) {
        // Delete any old webhook routes for this channel, then create correct one
        await db
          .delete(webhookRoutes)
          .where(eq(webhookRoutes.botChannelId, channelId));

        await db.insert(webhookRoutes).values({
          id: createId(),
          channelType: "slack",
          externalId: slackExternalId,
          poolId: bot.poolId,
          botChannelId: channelId,
          botId,
          accountId,
          updatedAt: now,
          createdAt: now,
        });
      }
    } else {
      // New connection
      channelId = createId();

      await db.insert(botChannels).values({
        id: channelId,
        botId,
        channelType: "slack",
        accountId,
        status: "connected",
        channelConfig: JSON.stringify({
          teamId,
          teamName: teamName ?? null,
          appId,
          botUserId: botUserId ?? null,
        }),
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(channelCredentials).values([
        {
          id: createId(),
          botChannelId: channelId,
          credentialType: "botToken",
          encryptedValue: encrypt(input.botToken),
          createdAt: now,
        },
        {
          id: createId(),
          botChannelId: channelId,
          credentialType: "signingSecret",
          encryptedValue: encrypt(input.signingSecret),
          createdAt: now,
        },
      ]);

      if (bot.poolId) {
        await db.insert(webhookRoutes).values({
          id: createId(),
          channelType: "slack",
          externalId: slackExternalId,
          poolId: bot.poolId,
          botChannelId: channelId,
          botId,
          accountId,
          updatedAt: now,
          createdAt: now,
        });
      }
    }

    await publishSnapshotSafely(bot.poolId, bot.id);

    const [channel] = await db
      .select()
      .from(botChannels)
      .where(eq(botChannels.id, channelId));

    if (!channel) {
      throw ServiceError.from("channel-routes", {
        code: "channel_create_failed",
        channel_id: channelId,
        bot_id: bot.id,
      });
    }

    return c.json(formatChannel(channel), 200);
  });

  // -- Discord connect --
  app.openapi(connectDiscordRoute, async (c) => {
    const userId = c.get("userId");
    const input = c.req.valid("json");

    // Validate bot token against Discord API
    try {
      const discordResp = await fetch("https://discord.com/api/v10/users/@me", {
        headers: { Authorization: `Bot ${input.botToken}` },
      });
      if (!discordResp.ok) {
        const status = discordResp.status;
        return c.json(
          {
            message:
              status === 401
                ? "Invalid bot token"
                : `Discord API error (${status})`,
          },
          409,
        );
      }
    } catch {
      return c.json(
        { message: "Failed to reach Discord API to validate bot token" },
        409,
      );
    }

    // Validate that the provided Application ID matches the bot's actual application
    try {
      const appResp = await fetch(
        "https://discord.com/api/v10/applications/@me",
        {
          headers: { Authorization: `Bot ${input.botToken}` },
        },
      );
      if (appResp.ok) {
        const appData = (await appResp.json()) as { id: string };
        if (appData.id !== input.appId) {
          return c.json(
            {
              message: `Application ID mismatch: the bot token belongs to application ${appData.id}, but you entered ${input.appId}`,
            },
            409,
          );
        }
      }
    } catch {
      // Non-fatal: skip app ID validation if the endpoint is unavailable
    }

    const bot = await findOrCreateDefaultBot(userId);
    const botId = bot.id;

    const accountId = `discord-${input.appId}`;

    const [existing] = await db
      .select()
      .from(botChannels)
      .where(
        and(
          eq(botChannels.botId, botId),
          eq(botChannels.channelType, "discord"),
          eq(botChannels.accountId, accountId),
        ),
      );

    if (existing) {
      return c.json({ message: "Discord channel already connected" }, 409);
    }

    const channelId = createId();
    const now = new Date().toISOString();

    await db.insert(botChannels).values({
      id: channelId,
      botId,
      channelType: "discord",
      accountId,
      status: "connected",
      channelConfig: JSON.stringify({
        appId: input.appId,
        guildId: input.guildId ?? null,
        guildName: input.guildName ?? null,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(channelCredentials).values({
      id: createId(),
      botChannelId: channelId,
      credentialType: "botToken",
      encryptedValue: encrypt(input.botToken),
      createdAt: now,
    });

    await publishSnapshotSafely(bot.poolId, bot.id);

    const [channel] = await db
      .select()
      .from(botChannels)
      .where(eq(botChannels.id, channelId));

    if (!channel) {
      throw ServiceError.from("channel-routes", {
        code: "channel_create_failed",
        channel_id: channelId,
        bot_id: bot.id,
      });
    }

    return c.json(formatChannel(channel), 200);
  });

  // -- Feishu connect --
  app.openapi(connectFeishuRoute, async (c) => {
    const userId = c.get("userId");
    const input = c.req.valid("json");

    // Validate credentials by attempting to get a tenant token
    const tenantToken = await getFeishuTenantToken(
      input.appId,
      input.appSecret,
    );
    if (!tenantToken) {
      return c.json(
        {
          message: "Invalid Feishu credentials: could not obtain tenant token",
        },
        409,
      );
    }

    const bot = await findOrCreateDefaultBot(userId);
    const botId = bot.id;

    const accountId = `feishu-${input.appId}`;

    const [existing] = await db
      .select()
      .from(botChannels)
      .where(
        and(
          eq(botChannels.botId, botId),
          eq(botChannels.channelType, "feishu"),
          eq(botChannels.accountId, accountId),
        ),
      );

    if (existing) {
      return c.json({ message: "Feishu channel already connected" }, 409);
    }

    const channelId = createId();
    const now = new Date().toISOString();

    await db.insert(botChannels).values({
      id: channelId,
      botId,
      channelType: "feishu",
      accountId,
      status: "connected",
      channelConfig: JSON.stringify({
        appId: input.appId,
      }),
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(channelCredentials).values([
      {
        id: createId(),
        botChannelId: channelId,
        credentialType: "appId",
        encryptedValue: encrypt(input.appId),
        createdAt: now,
      },
      {
        id: createId(),
        botChannelId: channelId,
        credentialType: "appSecret",
        encryptedValue: encrypt(input.appSecret),
        createdAt: now,
      },
    ]);

    await publishSnapshotSafely(bot.poolId, bot.id);

    const [channel] = await db
      .select()
      .from(botChannels)
      .where(eq(botChannels.id, channelId));

    if (!channel) {
      throw ServiceError.from("channel-routes", {
        code: "channel_create_failed",
        channel_id: channelId,
        bot_id: bot.id,
      });
    }

    return c.json(formatChannel(channel), 200);
  });

  // -- List channels --
  app.openapi(listChannelsRoute, async (c) => {
    const userId = c.get("userId");

    // Find user's bot; if none exists, return empty list
    const [bot] = await db
      .select()
      .from(bots)
      .where(
        and(
          eq(bots.userId, userId),
          or(eq(bots.status, "active"), eq(bots.status, "paused")),
        ),
      );

    if (!bot) {
      return c.json({ channels: [] }, 200);
    }

    const channels = await db
      .select()
      .from(botChannels)
      .where(eq(botChannels.botId, bot.id));

    // Lazy backfill: resolve botUserId for Slack channels missing it
    const backfillPromises = channels
      .filter((ch) => {
        if (ch.channelType !== "slack") return false;
        try {
          const config =
            typeof ch.channelConfig === "string"
              ? JSON.parse(ch.channelConfig)
              : ((ch.channelConfig as unknown as Record<string, unknown>) ??
                {});
          return !config?.botUserId;
        } catch {
          return false;
        }
      })
      .map(async (ch) => {
        try {
          const [cred] = await db
            .select()
            .from(channelCredentials)
            .where(
              and(
                eq(channelCredentials.botChannelId, ch.id),
                eq(channelCredentials.credentialType, "botToken"),
              ),
            );
          if (!cred) return;

          const botToken = decrypt(cred.encryptedValue);
          const authResp = await channelSpanHandler.slackAuthTest(botToken);
          const authData = (await authResp.json()) as {
            ok: boolean;
            user_id?: string;
          };
          if (!authData.ok || !authData.user_id) return;

          const config =
            typeof ch.channelConfig === "string"
              ? JSON.parse(ch.channelConfig)
              : ((ch.channelConfig as unknown as Record<string, unknown>) ??
                {});
          const updatedConfig = { ...config, botUserId: authData.user_id };

          await db
            .update(botChannels)
            .set({
              channelConfig: JSON.stringify(updatedConfig),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(botChannels.id, ch.id));

          ch.channelConfig = JSON.stringify(updatedConfig);
        } catch {
          // Non-critical — skip silently, will retry on next page load
        }
      });

    await Promise.all(backfillPromises);

    return c.json({ channels: channels.map(formatChannel) }, 200);
  });

  // -- Disconnect channel --
  app.openapi(disconnectChannelRoute, async (c) => {
    const { channelId } = c.req.valid("param");
    const userId = c.get("userId");

    // Find any bot owned by this user (including deleted for orphan cleanup)
    const userBots = await db
      .select()
      .from(bots)
      .where(eq(bots.userId, userId));

    if (userBots.length === 0) {
      return c.json({ message: "Channel not found" }, 404);
    }

    const userBotIds = new Set(userBots.map((b) => b.id));

    const [channel] = await db
      .select()
      .from(botChannels)
      .where(eq(botChannels.id, channelId));

    if (!channel || !userBotIds.has(channel.botId)) {
      return c.json({ message: `Channel ${channelId} not found` }, 404);
    }

    await db
      .delete(webhookRoutes)
      .where(eq(webhookRoutes.botChannelId, channelId));

    await db
      .delete(channelCredentials)
      .where(eq(channelCredentials.botChannelId, channelId));

    await db.delete(botChannels).where(eq(botChannels.id, channelId));

    const ownerBot = userBots.find((b) => b.id === channel.botId);
    if (ownerBot?.poolId) {
      await publishSnapshotSafely(ownerBot.poolId, ownerBot.id);
    }

    return c.json({ success: true }, 200);
  });

  // -- Channel status --
  app.openapi(channelStatusRoute, async (c) => {
    const { channelId } = c.req.valid("param");
    const userId = c.get("userId");

    // Find user's bot
    const [bot] = await db
      .select()
      .from(bots)
      .where(
        and(
          eq(bots.userId, userId),
          or(eq(bots.status, "active"), eq(bots.status, "paused")),
        ),
      );

    if (!bot) {
      return c.json({ message: "Channel not found" }, 404);
    }

    const [channel] = await db
      .select()
      .from(botChannels)
      .where(and(eq(botChannels.id, channelId), eq(botChannels.botId, bot.id)));

    if (!channel) {
      return c.json({ message: `Channel ${channelId} not found` }, 404);
    }

    return c.json(formatChannel(channel), 200);
  });
}

// ---------------------------------------------------------------------------
// Slack OAuth callback (unauthenticated — called by browser redirect from Slack)
// ---------------------------------------------------------------------------

export function registerSlackOAuthCallback(app: OpenAPIHono<AppBindings>) {
  app.get("/api/oauth/slack/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const slackError = c.req.query("error");
    const webUrl = process.env.WEB_URL ?? "http://localhost:5173";

    const redirectWithError = (msg: string) => {
      const url = new URL("/workspace/channels/slack/callback", webUrl);
      url.searchParams.set("error", msg);
      return c.redirect(url.toString(), 302);
    };

    // --- 1. Handle Slack-side errors (user denied, etc.) ---
    if (slackError) {
      return redirectWithError(
        slackError === "access_denied"
          ? "You cancelled the Slack authorization"
          : `Slack error: ${slackError}`,
      );
    }

    if (!code || !state) {
      return redirectWithError("Missing authorization code or state parameter");
    }

    // --- 2. Validate state token (CSRF protection) ---
    const [stateRow] = await db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.state, state));

    if (!stateRow) {
      return redirectWithError(
        "Invalid or expired authorization. Please try again.",
      );
    }

    if (stateRow.usedAt) {
      return redirectWithError(
        "This authorization link has already been used.",
      );
    }

    if (new Date(stateRow.expiresAt) < new Date()) {
      return redirectWithError("Authorization expired. Please try again.");
    }

    // --- 3. Mark state as used (prevent replay) ---
    await db
      .update(oauthStates)
      .set({ usedAt: new Date().toISOString() })
      .where(eq(oauthStates.id, stateRow.id));

    const { userId } = stateRow;

    // --- 4. Exchange code for token with Slack ---
    const clientId = process.env.SLACK_CLIENT_ID;
    const clientSecret = process.env.SLACK_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      return redirectWithError("Slack OAuth is not configured on this server");
    }

    let tokenResponse: SlackOAuthV2Response;
    try {
      const resp = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          code,
          redirect_uri: getSlackRedirectUri(),
        }),
      });

      tokenResponse = (await resp.json()) as SlackOAuthV2Response;
    } catch {
      return redirectWithError("Failed to communicate with Slack");
    }

    if (!tokenResponse.ok) {
      return redirectWithError(
        `Slack token exchange failed: ${tokenResponse.error ?? "unknown error"}`,
      );
    }

    const teamId = tokenResponse.team.id;
    const teamName = tokenResponse.team.name;
    const botToken = tokenResponse.access_token;
    const botUserId = tokenResponse.bot_user_id;

    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      return redirectWithError(
        "SLACK_SIGNING_SECRET is not configured on this server",
      );
    }

    const appId = tokenResponse.app_id;
    const accountId = `slack-${appId}-${teamId}`;
    const oldAccountId = `slack-${appId}`;
    const slackExternalId = `${teamId}:${appId}`;

    // --- 5. Find or create the user's default bot ---
    const bot = await findOrCreateDefaultBot(userId);
    const botId = bot.id;

    // --- 6. Create or update the channel connection ---
    const existingSlackChannels = await db
      .select()
      .from(botChannels)
      .where(
        and(eq(botChannels.botId, botId), eq(botChannels.channelType, "slack")),
      );
    const existing = existingSlackChannels.find(
      (ch) => ch.accountId === accountId || ch.accountId === oldAccountId,
    );

    const now = new Date().toISOString();
    let channelId: string;

    if (existing) {
      // Reconnect: update existing channel credentials
      channelId = existing.id;

      await db
        .update(botChannels)
        .set({
          status: "connected",
          accountId,
          channelConfig: JSON.stringify({ teamId, teamName, appId, botUserId }),
          updatedAt: now,
        })
        .where(eq(botChannels.id, channelId));

      // Replace credentials (delete + re-insert)
      await db
        .delete(channelCredentials)
        .where(eq(channelCredentials.botChannelId, channelId));

      await db.insert(channelCredentials).values([
        {
          id: createId(),
          botChannelId: channelId,
          credentialType: "botToken",
          encryptedValue: encrypt(botToken),
          createdAt: now,
        },
        {
          id: createId(),
          botChannelId: channelId,
          credentialType: "signingSecret",
          encryptedValue: encrypt(signingSecret),
          createdAt: now,
        },
      ]);

      if (bot.poolId) {
        await db
          .update(webhookRoutes)
          .set({
            poolId: bot.poolId,
            accountId,
            botId,
            updatedAt: now,
          })
          .where(
            and(
              eq(webhookRoutes.channelType, "slack"),
              eq(webhookRoutes.externalId, slackExternalId),
            ),
          );
      }
    } else {
      // New connection — check global uniqueness first
      const [globalExisting] = await db
        .select()
        .from(webhookRoutes)
        .where(
          and(
            eq(webhookRoutes.channelType, "slack"),
            eq(webhookRoutes.externalId, slackExternalId),
          ),
        );

      if (globalExisting) {
        return redirectWithError(
          "This Slack app is already connected to another bot",
        );
      }

      channelId = createId();

      await db.insert(botChannels).values({
        id: channelId,
        botId,
        channelType: "slack",
        accountId,
        status: "connected",
        channelConfig: JSON.stringify({ teamId, teamName, appId, botUserId }),
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(channelCredentials).values([
        {
          id: createId(),
          botChannelId: channelId,
          credentialType: "botToken",
          encryptedValue: encrypt(botToken),
          createdAt: now,
        },
        {
          id: createId(),
          botChannelId: channelId,
          credentialType: "signingSecret",
          encryptedValue: encrypt(signingSecret),
          createdAt: now,
        },
      ]);

      if (bot.poolId) {
        await db.insert(webhookRoutes).values({
          id: createId(),
          channelType: "slack",
          externalId: slackExternalId,
          poolId: bot.poolId,
          botChannelId: channelId,
          botId,
          accountId,
          updatedAt: now,
          createdAt: now,
        });
      }
    }

    await publishSnapshotSafely(bot.poolId, botId);

    // --- 7. Cleanup expired states (opportunistic) ---
    await db.delete(oauthStates).where(lt(oauthStates.expiresAt, now));

    // --- 8. Redirect to frontend success page ---
    const successUrl = new URL("/workspace/channels/slack/callback", webUrl);
    successUrl.searchParams.set("success", "true");
    successUrl.searchParams.set("channelId", channelId);
    successUrl.searchParams.set("teamName", teamName);
    if (stateRow.returnTo) {
      successUrl.searchParams.set("returnTo", stateRow.returnTo);
    }
    return c.redirect(successUrl.toString(), 302);
  });
}
