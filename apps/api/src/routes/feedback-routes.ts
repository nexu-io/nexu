import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { bots } from "../db/schema/index.js";
import { sendFeishuWebhook } from "../lib/feishu-webhook.js";
import { logger } from "../lib/logger.js";
import { requireSkillToken } from "../middleware/internal-auth.js";
import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const feedbackBodySchema = z.object({
  content: z.string().min(1).max(5000),
  channel: z.string().optional(),
  sender: z.string().optional(),
  agentId: z.string().optional(),
  conversationContext: z.string().max(10000).optional(),
});

const feedbackResponseSchema = z.object({
  ok: z.boolean(),
});

const postFeedbackRoute = createRoute({
  method: "post",
  path: "/api/internal/feedback",
  tags: ["Internal"],
  request: {
    body: {
      content: { "application/json": { schema: feedbackBodySchema } },
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: feedbackResponseSchema } },
      description: "Feedback received",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid body",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Unauthorized",
    },
  },
});

async function lookupBotOwner(agentId: string): Promise<{
  botId: string;
  botName: string;
  ownerEmail: string;
  ownerName: string;
} | null> {
  try {
    const rows = await db
      .select({
        botId: bots.id,
        botName: bots.name,
        ownerEmail: sql<string>`au.email`,
        ownerName: sql<string>`au.name`,
      })
      .from(bots)
      .innerJoin(sql`"user" au`, sql`${bots.userId} = au.id`)
      .where(eq(bots.id, agentId))
      .limit(1);

    return rows[0] ?? null;
  } catch (error) {
    logger.warn({
      message: "feedback_bot_lookup_failed",
      scope: "feedback",
      agent_id: agentId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function registerFeedbackRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(postFeedbackRoute, async (c) => {
    requireSkillToken(c);

    const body = c.req.valid("json");

    const botOwner = body.agentId ? await lookupBotOwner(body.agentId) : null;

    logger.info({
      message: "feedback_received",
      scope: "feedback",
      channel: body.channel,
      sender: body.sender,
      agent_id: body.agentId,
      content_length: body.content.length,
    });

    const sent = await sendFeishuWebhook({
      content: body.content,
      channel: body.channel,
      sender: body.sender,
      agentId: botOwner?.botId,
      botName: botOwner?.botName,
      ownerEmail: botOwner?.ownerEmail,
      ownerName: botOwner?.ownerName,
      conversationContext: body.conversationContext,
    });

    if (!sent) {
      logger.warn({
        message: "feedback_forward_failed",
        scope: "feedback",
        agent_id: body.agentId,
      });
    }

    return c.json({ ok: true }, 200);
  });
}
