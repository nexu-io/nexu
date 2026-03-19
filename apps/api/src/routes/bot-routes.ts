import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  botListResponseSchema,
  botResponseSchema,
  createBotSchema,
  updateBotSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  botChannels,
  bots,
  channelCredentials,
  gatewayAssignments,
  gatewayPools,
  webhookRoutes,
} from "../db/schema/index.js";
import { BaseError, ServiceError } from "../lib/error.js";
import { logger } from "../lib/logger.js";
import { publishPoolConfigSnapshot } from "../services/runtime/pool-config-service.js";

import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const botIdParam = z.object({
  botId: z.string(),
});

const createBotRoute = createRoute({
  method: "post",
  path: "/api/v1/bots",
  tags: ["Bots"],
  request: {
    body: { content: { "application/json": { schema: createBotSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: botResponseSchema } },
      description: "Bot created",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid pool state",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Pool not found",
    },
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Slug already exists",
    },
  },
});

const listBotsRoute = createRoute({
  method: "get",
  path: "/api/v1/bots",
  tags: ["Bots"],
  responses: {
    200: {
      content: { "application/json": { schema: botListResponseSchema } },
      description: "Bot list",
    },
  },
});

const getBotRoute = createRoute({
  method: "get",
  path: "/api/v1/bots/{botId}",
  tags: ["Bots"],
  request: {
    params: botIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: botResponseSchema } },
      description: "Bot details",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Bot not found",
    },
  },
});

const updateBotRoute = createRoute({
  method: "patch",
  path: "/api/v1/bots/{botId}",
  tags: ["Bots"],
  request: {
    params: botIdParam,
    body: { content: { "application/json": { schema: updateBotSchema } } },
  },
  responses: {
    200: {
      content: { "application/json": { schema: botResponseSchema } },
      description: "Bot updated",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Bot not found",
    },
  },
});

const deleteBotRoute = createRoute({
  method: "delete",
  path: "/api/v1/bots/{botId}",
  tags: ["Bots"],
  request: {
    params: botIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.object({ success: z.boolean() }) },
      },
      description: "Bot deleted",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Bot not found",
    },
  },
});

const pauseBotRoute = createRoute({
  method: "post",
  path: "/api/v1/bots/{botId}/pause",
  tags: ["Bots"],
  request: {
    params: botIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: botResponseSchema } },
      description: "Bot paused",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Bot not found",
    },
  },
});

const resumeBotRoute = createRoute({
  method: "post",
  path: "/api/v1/bots/{botId}/resume",
  tags: ["Bots"],
  request: {
    params: botIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: botResponseSchema } },
      description: "Bot resumed",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Bot not found",
    },
  },
});

function formatBot(
  bot: typeof bots.$inferSelect,
): z.infer<typeof botResponseSchema> {
  return {
    id: bot.id,
    name: bot.name,
    slug: bot.slug,
    poolId: bot.poolId ?? null,
    status: (bot.status ?? "active") as "active" | "paused" | "deleted",
    modelId:
      bot.modelId ?? process.env.DEFAULT_MODEL_ID ?? "link/claude-sonnet-4-5",
    systemPrompt: bot.systemPrompt,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
  };
}

async function findOrCreateDefaultPool(): Promise<string> {
  const [existing] = await db
    .select()
    .from(gatewayPools)
    .where(eq(gatewayPools.poolName, "default"));

  if (existing) {
    return existing.id;
  }

  const poolId = createId();
  await db.insert(gatewayPools).values({
    id: poolId,
    poolName: "default",
    poolType: "shared",
    status: "active",
  });

  return poolId;
}

export function registerBotRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(createBotRoute, async (c) => {
    const input = c.req.valid("json");
    const userId = c.get("userId");

    let poolId = input.poolId;
    if (poolId) {
      const [requestedPool] = await db
        .select()
        .from(gatewayPools)
        .where(eq(gatewayPools.id, poolId));

      if (!requestedPool) {
        return c.json({ message: `Pool ${poolId} not found` }, 404);
      }

      if (requestedPool.status !== "active") {
        return c.json({ message: `Pool ${poolId} is not active` }, 400);
      }
    } else {
      poolId = await findOrCreateDefaultPool();
    }

    if (!poolId) {
      throw ServiceError.from("bot-routes", {
        code: "pool_selection_failed",
      });
    }

    const botId = createId();
    const now = new Date().toISOString();

    const [existingBot] = await db
      .select()
      .from(bots)
      .where(and(eq(bots.userId, userId), eq(bots.slug, input.slug)));

    if (existingBot) {
      return c.json({ message: "Bot slug already exists" }, 409);
    }

    await db.transaction(async (tx) => {
      await tx.insert(bots).values({
        id: botId,
        userId,
        name: input.name,
        slug: input.slug,
        systemPrompt: input.systemPrompt,
        modelId: input.modelId,
        poolId,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(gatewayAssignments).values({
        id: createId(),
        botId,
        poolId,
        assignedAt: now,
      });
    });

    try {
      await publishPoolConfigSnapshot(db, poolId);
    } catch (error) {
      const unknownError = BaseError.from(error);
      logger.error({
        message: "bots_publish_snapshot_failed",
        scope: "bots_publish_snapshot",
        pool_id: poolId,
        bot_id: botId,
        ...unknownError.toJSON(),
      });
    }

    const [bot] = await db.select().from(bots).where(eq(bots.id, botId));
    if (!bot) {
      throw ServiceError.from("bot-routes", {
        code: "bot_create_failed",
        bot_id: botId,
      });
    }

    return c.json(formatBot(bot), 200);
  });

  app.openapi(listBotsRoute, async (c) => {
    const userId = c.get("userId");
    const result = await db
      .select()
      .from(bots)
      .where(
        and(
          eq(bots.userId, userId),
          or(eq(bots.status, "active"), eq(bots.status, "paused")),
        ),
      );

    return c.json({ bots: result.map(formatBot) }, 200);
  });

  app.openapi(getBotRoute, async (c) => {
    const { botId } = c.req.valid("param");
    const userId = c.get("userId");

    const [bot] = await db
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)));

    if (!bot) {
      return c.json({ message: `Bot ${botId} not found` }, 404);
    }

    return c.json(formatBot(bot), 200);
  });

  app.openapi(updateBotRoute, async (c) => {
    const { botId } = c.req.valid("param");
    const userId = c.get("userId");
    const input = c.req.valid("json");

    const [bot] = await db
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)));

    if (!bot) {
      return c.json({ message: `Bot ${botId} not found` }, 404);
    }

    const now = new Date().toISOString();
    await db
      .update(bots)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.systemPrompt !== undefined && {
          systemPrompt: input.systemPrompt,
        }),
        ...(input.modelId !== undefined && { modelId: input.modelId }),
        updatedAt: now,
      })
      .where(eq(bots.id, botId));

    const [updated] = await db.select().from(bots).where(eq(bots.id, botId));
    if (!updated) {
      throw ServiceError.from("bot-routes", {
        code: "bot_update_failed",
        bot_id: botId,
      });
    }

    if (updated.poolId) {
      try {
        await publishPoolConfigSnapshot(db, updated.poolId);
      } catch (error) {
        const unknownError = BaseError.from(error);
        logger.error({
          message: "bots_publish_snapshot_failed",
          scope: "bots_publish_snapshot",
          pool_id: updated.poolId,
          bot_id: botId,
          ...unknownError.toJSON(),
        });
      }
    }

    return c.json(formatBot(updated), 200);
  });

  app.openapi(deleteBotRoute, async (c) => {
    const { botId } = c.req.valid("param");
    const userId = c.get("userId");

    const [bot] = await db
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)));

    if (!bot) {
      return c.json({ message: `Bot ${botId} not found` }, 404);
    }

    // Clean up associated channels before deleting the bot
    const channels = await db
      .select({ id: botChannels.id })
      .from(botChannels)
      .where(eq(botChannels.botId, botId));

    for (const ch of channels) {
      await db
        .delete(webhookRoutes)
        .where(eq(webhookRoutes.botChannelId, ch.id));
      await db
        .delete(channelCredentials)
        .where(eq(channelCredentials.botChannelId, ch.id));
    }

    await db.delete(botChannels).where(eq(botChannels.botId, botId));

    await db
      .delete(gatewayAssignments)
      .where(eq(gatewayAssignments.botId, botId));

    await db
      .update(bots)
      .set({ status: "deleted", updatedAt: new Date().toISOString() })
      .where(eq(bots.id, botId));

    if (bot.poolId) {
      try {
        await publishPoolConfigSnapshot(db, bot.poolId);
      } catch (error) {
        const unknownError = BaseError.from(error);
        logger.error({
          message: "bots_publish_snapshot_failed",
          scope: "bots_publish_snapshot",
          pool_id: bot.poolId,
          bot_id: botId,
          ...unknownError.toJSON(),
        });
      }
    }

    return c.json({ success: true }, 200);
  });

  app.openapi(pauseBotRoute, async (c) => {
    const { botId } = c.req.valid("param");
    const userId = c.get("userId");

    const [bot] = await db
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)));

    if (!bot) {
      return c.json({ message: `Bot ${botId} not found` }, 404);
    }

    await db
      .update(bots)
      .set({ status: "paused", updatedAt: new Date().toISOString() })
      .where(eq(bots.id, botId));

    const [updated] = await db.select().from(bots).where(eq(bots.id, botId));
    if (!updated) {
      throw ServiceError.from("bot-routes", {
        code: "bot_pause_failed",
        bot_id: botId,
      });
    }

    if (updated.poolId) {
      try {
        await publishPoolConfigSnapshot(db, updated.poolId);
      } catch (error) {
        const unknownError = BaseError.from(error);
        logger.error({
          message: "bots_publish_snapshot_failed",
          scope: "bots_publish_snapshot",
          pool_id: updated.poolId,
          bot_id: botId,
          ...unknownError.toJSON(),
        });
      }
    }

    return c.json(formatBot(updated), 200);
  });

  app.openapi(resumeBotRoute, async (c) => {
    const { botId } = c.req.valid("param");
    const userId = c.get("userId");

    const [bot] = await db
      .select()
      .from(bots)
      .where(and(eq(bots.id, botId), eq(bots.userId, userId)));

    if (!bot) {
      return c.json({ message: `Bot ${botId} not found` }, 404);
    }

    await db
      .update(bots)
      .set({ status: "active", updatedAt: new Date().toISOString() })
      .where(eq(bots.id, botId));

    const [updated] = await db.select().from(bots).where(eq(bots.id, botId));
    if (!updated) {
      throw ServiceError.from("bot-routes", {
        code: "bot_resume_failed",
        bot_id: botId,
      });
    }

    if (updated.poolId) {
      try {
        await publishPoolConfigSnapshot(db, updated.poolId);
      } catch (error) {
        const unknownError = BaseError.from(error);
        logger.error({
          message: "bots_publish_snapshot_failed",
          scope: "bots_publish_snapshot",
          pool_id: updated.poolId,
          bot_id: botId,
          ...unknownError.toJSON(),
        });
      }
    }

    return c.json(formatBot(updated), 200);
  });
}
