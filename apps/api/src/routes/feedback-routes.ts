import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { botChannels, bots, channelCredentials } from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
import {
  getFeishuTenantToken,
  sendFeishuFileMessage,
  sendFeishuImageMessage,
  sendFeishuWebhook,
  uploadFileToFeishu,
  uploadImageToFeishu,
} from "../lib/feishu-webhook.js";
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
  imageUrls: z.array(z.string().url()).max(10).optional(),
  imageData: z
    .array(z.object({ data: z.string(), mimeType: z.string() }))
    .max(5)
    .optional(),
  fileData: z
    .array(z.object({ data: z.string(), fileName: z.string() }))
    .max(5)
    .optional(),
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

async function lookupFeishuCredentials(
  agentId: string,
): Promise<{ appId: string; appSecret: string } | null> {
  try {
    const [ch] = await db
      .select({ id: botChannels.id })
      .from(botChannels)
      .where(
        and(
          eq(botChannels.botId, agentId),
          eq(botChannels.channelType, "feishu"),
          eq(botChannels.status, "connected"),
        ),
      )
      .limit(1);

    if (!ch) return null;

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
    if (!appId || !appSecret) return null;

    return { appId, appSecret };
  } catch (error) {
    logger.warn({
      message: "feedback_feishu_cred_lookup_failed",
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

    const hasImages =
      (body.imageUrls && body.imageUrls.length > 0) ||
      (body.imageData && body.imageData.length > 0);
    const hasFiles = body.fileData && body.fileData.length > 0;

    const feishuCreds =
      (hasImages || hasFiles) && body.agentId
        ? await lookupFeishuCredentials(body.agentId)
        : null;

    // Pre-upload base64 images from imageData
    const preUploadedImageKeys: string[] = [];

    if (body.imageData && body.imageData.length > 0 && feishuCreds) {
      const tenantToken = await getFeishuTenantToken(
        feishuCreds.appId,
        feishuCreds.appSecret,
      );
      if (tenantToken) {
        const results = await Promise.allSettled(
          body.imageData.map((img) =>
            uploadImageToFeishu(Buffer.from(img.data, "base64"), tenantToken),
          ),
        );
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            preUploadedImageKeys.push(r.value);
          }
        }
      }
    }

    // sendFeishuWebhook returns message_id (Bot API) or "webhook" or null
    const sendResult = await sendFeishuWebhook({
      content: body.content,
      channel: body.channel,
      sender: body.sender,
      agentId: botOwner?.botId,
      botName: botOwner?.botName,
      ownerEmail: botOwner?.ownerEmail,
      ownerName: botOwner?.ownerName,
      conversationContext: body.conversationContext,
      imageUrls: body.imageUrls,
      feishuAppId: feishuCreds?.appId,
      feishuAppSecret: feishuCreds?.appSecret,
      preUploadedImageKeys:
        preUploadedImageKeys.length > 0 ? preUploadedImageKeys : undefined,
    });

    if (!sendResult) {
      logger.warn({
        message: "feedback_forward_failed",
        scope: "feedback",
        agent_id: body.agentId,
      });
    }

    // Send images and files as replies to the card message
    const feedbackChatId = process.env.FEISHU_FEEDBACK_CHAT_ID;
    const replyMessageId =
      sendResult && sendResult !== "webhook" ? sendResult : undefined;
    const hasAttachments =
      preUploadedImageKeys.length > 0 || (hasFiles && body.fileData);

    if (hasAttachments && feishuCreds && feedbackChatId) {
      const tenantToken = await getFeishuTenantToken(
        feishuCreds.appId,
        feishuCreds.appSecret,
      );
      if (tenantToken) {
        // Send images as replies
        for (const imageKey of preUploadedImageKeys) {
          await sendFeishuImageMessage(
            imageKey,
            feedbackChatId,
            tenantToken,
            replyMessageId,
          );
        }
        // Send files as replies
        if (body.fileData) {
          for (const file of body.fileData) {
            const fileKey = await uploadFileToFeishu(
              Buffer.from(file.data, "base64"),
              file.fileName,
              tenantToken,
            );
            if (fileKey) {
              await sendFeishuFileMessage(
                fileKey,
                feedbackChatId,
                tenantToken,
                replyMessageId,
              );
            }
          }
        }
      }
    }

    return c.json({ ok: true }, 200);
  });
}
