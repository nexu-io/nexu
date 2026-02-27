import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  channelListResponseSchema,
  channelResponseSchema,
  connectDiscordSchema,
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
import { encrypt } from "../lib/crypto.js";
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
    channelType: ch.channelType as "slack" | "discord",
    accountId: ch.accountId,
    status: (ch.status ?? "pending") as
      | "pending"
      | "connected"
      | "disconnected"
      | "error",
    teamName: (config.teamName as string) ?? null,
    appId: (config.appId as string) ?? null,
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
    await publishPoolConfigSnapshot(db, poolId);
  } catch (error) {
    console.error("[channels] failed to publish pool config snapshot", {
      poolId,
      botId,
      error: error instanceof Error ? error.message : "unknown_error",
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
  "users:read",
].join(",");

// ---------------------------------------------------------------------------
// OpenAPI route definitions (user-scoped, no botId param)
// ---------------------------------------------------------------------------

const slackOAuthUrlRoute = createRoute({
  method: "get",
  path: "/v1/channels/slack/oauth-url",
  tags: ["Channels"],
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
  path: "/v1/channels/slack/connect",
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
  path: "/v1/channels",
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
  path: "/v1/channels/{channelId}",
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
  path: "/v1/channels/discord/connect",
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

const channelStatusRoute = createRoute({
  method: "get",
  path: "/v1/channels/{channelId}/status",
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

// ---------------------------------------------------------------------------
// Authenticated channel routes (under /v1/*)
// ---------------------------------------------------------------------------

export function registerChannelRoutes(app: OpenAPIHono<AppBindings>) {
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

    await db.insert(oauthStates).values({
      id: createId(),
      state: nonce,
      userId,
      expiresAt,
    });

    const url = new URL("https://slack.com/oauth/v2/authorize");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("scope", SLACK_BOT_SCOPES);
    url.searchParams.set("redirect_uri", getSlackRedirectUri());
    url.searchParams.set("state", nonce);

    return c.json({ url: url.toString() }, 200);
  });

  // -- Manual Slack connect (authenticated) --
  app.openapi(connectSlackRoute, async (c) => {
    const userId = c.get("userId");
    const input = c.req.valid("json");

    const bot = await findOrCreateDefaultBot(userId);
    const botId = bot.id;

    const accountId = `slack-${input.appId}`;
    const slackExternalId = `${input.teamId}:${input.appId}`;

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
      return c.json(
        {
          message: "This Slack app is already connected to another bot",
        },
        409,
      );
    }

    const [existing] = await db
      .select()
      .from(botChannels)
      .where(
        and(
          eq(botChannels.botId, botId),
          eq(botChannels.channelType, "slack"),
          eq(botChannels.accountId, accountId),
        ),
      );

    if (existing) {
      return c.json({ message: "Slack channel already connected" }, 409);
    }

    const channelId = createId();
    const now = new Date().toISOString();

    await db.insert(botChannels).values({
      id: channelId,
      botId,
      channelType: "slack",
      accountId,
      status: "connected",
      channelConfig: JSON.stringify({
        teamId: input.teamId,
        teamName: input.teamName ?? null,
        appId: input.appId,
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

    await db.insert(channelCredentials).values({
      id: createId(),
      botChannelId: channelId,
      credentialType: "signingSecret",
      encryptedValue: encrypt(input.signingSecret),
      createdAt: now,
    });

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

    await publishSnapshotSafely(bot.poolId, bot.id);

    const [channel] = await db
      .select()
      .from(botChannels)
      .where(eq(botChannels.id, channelId));

    if (!channel) {
      throw new Error("Failed to create channel");
    }

    return c.json(formatChannel(channel), 200);
  });

  // -- Discord connect --
  app.openapi(connectDiscordRoute, async (c) => {
    const userId = c.get("userId");
    const input = c.req.valid("json");

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
      throw new Error("Failed to create channel");
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

    return c.json({ channels: channels.map(formatChannel) }, 200);
  });

  // -- Disconnect channel --
  app.openapi(disconnectChannelRoute, async (c) => {
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

    await db
      .delete(webhookRoutes)
      .where(eq(webhookRoutes.botChannelId, channelId));

    await db
      .delete(channelCredentials)
      .where(eq(channelCredentials.botChannelId, channelId));

    await db.delete(botChannels).where(eq(botChannels.id, channelId));

    await publishSnapshotSafely(bot.poolId, bot.id);

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

    const signingSecret = process.env.SLACK_SIGNING_SECRET;
    if (!signingSecret) {
      return redirectWithError(
        "SLACK_SIGNING_SECRET is not configured on this server",
      );
    }

    const appId = tokenResponse.app_id;
    const accountId = `slack-${appId}`;
    const slackExternalId = `${teamId}:${appId}`;

    // --- 5. Find or create the user's default bot ---
    const bot = await findOrCreateDefaultBot(userId);
    const botId = bot.id;

    // --- 6. Create or update the channel connection ---
    const [existing] = await db
      .select()
      .from(botChannels)
      .where(
        and(
          eq(botChannels.botId, botId),
          eq(botChannels.channelType, "slack"),
          eq(botChannels.accountId, accountId),
        ),
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
          channelConfig: JSON.stringify({ teamId, teamName, appId }),
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
          .where(eq(webhookRoutes.botChannelId, channelId));
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
        channelConfig: JSON.stringify({ teamId, teamName, appId }),
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
    return c.redirect(successUrl.toString(), 302);
  });
}
