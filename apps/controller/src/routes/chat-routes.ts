import { type OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { sessionResponseSchema } from "@nexu/shared";
import type { ControllerContainer } from "../app/container.js";
import { ChatService } from "../services/chat-service.js";
import type { ControllerBindings } from "../types.js";

// ~10 MB base64 cap → raw file ≈ 7.5 MB; prevents OOM/body-size attacks
const MAX_ATTACHMENT_CONTENT_BYTES = 10_000_000;

const chatAttachmentSchema = z.object({
  // Images go through OpenClaw's chat.send attachments pipeline unchanged.
  // Files (PDF / text-readable) are extracted on the controller and folded
  // into message text as <file>…</file> blocks before forwarding; OpenClaw's
  // gateway RPC itself only carries images over the wire.
  type: z.enum(["image", "file"]),
  content: z.string().max(MAX_ATTACHMENT_CONTENT_BYTES),
  metadata: z
    .object({
      mimeType: z.string().optional(),
      filename: z.string().optional(),
      size: z.number().optional(),
    })
    .optional(),
});

const localChatMessageInputSchema = z.object({
  type: z.enum(["text", "image", "video", "audio", "file"]),
  content: z.string().max(MAX_ATTACHMENT_CONTENT_BYTES),
  metadata: z
    .object({
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.number().optional(),
      mimeType: z.string().optional(),
      filename: z.string().optional(),
      size: z.number().optional(),
    })
    .optional(),
  /** Optional additional attachments for multipart (text + images/files) messages */
  attachments: z.array(chatAttachmentSchema).optional(),
});

const localChatMessageOutputSchema = z.object({
  id: z.string(),
  role: z.string(),
  type: z.string(),
  content: z.unknown(),
  timestamp: z.number().nullable(),
  createdAt: z.string().nullable(),
});

export function registerChatRoutes(
  app: OpenAPIHono<ControllerBindings>,
  container: ControllerContainer,
): void {
  const chatService = new ChatService(
    container.gatewayService,
    container.attachmentStore,
  );

  // GET /api/v1/chat/session - Resolve a named sessionKey to a real session
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/chat/session",
      tags: ["Chat"],
      request: {
        query: z.object({
          botId: z.string(),
          sessionKey: z.string(),
        }),
      },
      responses: {
        200: {
          description: "Session resolved from sessionKey",
          content: {
            "application/json": {
              schema: z.object({
                session: sessionResponseSchema.nullable(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, sessionKey } = c.req.valid("query");
      const session = await container.sessionService.getSessionBySessionKey(
        botId,
        sessionKey,
      );
      return c.json({ session });
    },
  );

  // POST /api/v1/chat/local - Send local chat message (direct to main session)
  app.openapi(
    createRoute({
      method: "post",
      path: "/api/v1/chat/local",
      tags: ["Chat"],
      request: {
        body: {
          content: {
            "application/json": {
              schema: z.object({
                botId: z.string(),
                sessionKey: z.string(),
                message: localChatMessageInputSchema,
              }),
            },
          },
        },
      },
      responses: {
        200: {
          description: "Local chat message sent",
          content: {
            "application/json": {
              schema: z.object({
                session: sessionResponseSchema.nullable(),
                message: localChatMessageOutputSchema,
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, message } = c.req.valid("json");

      // Send message to agent main session — do NOT pre-create the session
      // here.  Pre-creating writes an empty key-based .jsonl file that
      // appears as a ghost entry in the sessions list.  OpenClaw will create
      // the real UUID-named JSONL and register it in sessions.json as part of
      // processing chat.send, so we look it up afterwards.
      const result = await chatService.sendLocalMessage(botId, message);

      // Best-effort session lookup immediately after send.  sessions.json is
      // flushed asynchronously by OpenClaw, so this may return null on the
      // very first message.  The frontend handles that case with its own
      // 3-second discovery retry loop — no server-side sleep needed here.
      //
      // Always look up via the main session key — chat.send always targets
      // agent:{botId}:main regardless of which channel key the frontend
      // sends in the body (the body's sessionKey is informational only).
      const mainSessionKey = `agent:${botId}:main`;
      const session = await container.sessionService.getSessionBySessionKey(
        botId,
        mainSessionKey,
      );

      return c.json({
        session,
        message: result,
      });
    },
  );

  // GET /api/v1/chat/history - Full aggregated message history across all
  // compacted sessions for a bot's main webchat conversation.
  // When OpenClaw performs context compaction it creates a new UUID-named JSONL
  // and leaves previous session files orphaned on disk.  This endpoint collects
  // all such orphaned files plus the current main session file, sorts them
  // chronologically, and returns the concatenated message list — giving the
  // frontend a single continuous timeline regardless of how many compactions
  // have occurred.
  app.openapi(
    createRoute({
      method: "get",
      path: "/api/v1/chat/history",
      tags: ["Chat"],
      request: {
        query: z.object({
          botId: z.string(),
          limit: z.coerce.number().int().min(1).max(2000).optional(),
        }),
      },
      responses: {
        200: {
          description:
            "Full conversation history aggregated across all compacted sessions",
          content: {
            "application/json": {
              schema: z.object({
                messages: z.array(
                  z.object({
                    id: z.string(),
                    role: z.enum(["user", "assistant"]),
                    content: z.unknown(),
                    timestamp: z.number().nullable(),
                    createdAt: z.string().nullable(),
                  }),
                ),
                sessionCount: z.number(),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      const { botId, limit } = c.req.valid("query");
      const result = await container.sessionService.getFullMainChatHistory(
        botId,
        limit,
      );
      return c.json(result);
    },
  );
}
