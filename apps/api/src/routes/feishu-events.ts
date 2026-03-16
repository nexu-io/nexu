import crypto from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index.js";
import {
  channelCredentials,
  claimCardDedup,
  gatewayPools,
  sessionParticipants,
  sessions,
  webhookRoutes,
  workspaceMemberships,
} from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
import { BaseError } from "../lib/error.js";
import { buildFeishuBindPromptCard } from "../lib/feishu-claim-card.js";
import {
  getFeishuTenantToken,
  sendFeishuCardMessage,
} from "../lib/feishu-webhook.js";
import { logger } from "../lib/logger.js";
import { Span } from "../lib/trace-decorator.js";
import type { AppBindings } from "../types.js";

// ── In-memory LRU cache for registered users ──────────────────────────────
// Only caches positive results (user IS registered). Unregistered users always
// hit DB so that registration takes effect immediately.

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_MAX_SIZE = 10_000;

interface CacheEntry {
  userId: string;
  expiresAt: number;
}

const registeredUserCache = new Map<string, CacheEntry>();

function getCachedUserId(cacheKey: string): string | null {
  const entry = registeredUserCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    registeredUserCache.delete(cacheKey);
    return null;
  }
  return entry.userId;
}

function setCachedUserId(cacheKey: string, userId: string): void {
  // Evict oldest entries if cache is full
  if (registeredUserCache.size >= CACHE_MAX_SIZE) {
    const firstKey = registeredUserCache.keys().next().value;
    if (firstKey) registeredUserCache.delete(firstKey);
  }
  registeredUserCache.set(cacheKey, {
    userId,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ── Dedup: DB-level idempotency for claim card sending ───────────────────
// Uses claim_card_dedup table with feishu event_id as primary key.
// INSERT ON CONFLICT DO NOTHING — if insert succeeds, this pod sends the card;
// if conflict, another pod already handled it.

async function tryAcquireClaimLock(eventId: string): Promise<boolean> {
  try {
    const result = await db
      .insert(claimCardDedup)
      .values({ eventId })
      .onConflictDoNothing();
    return (result.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

// ── Feishu event decryption ───────────────────────────────────────────────

function decryptFeishuEvent(encryptedBody: string, encryptKey: string): string {
  const buf = Buffer.from(encryptedBody, "base64");
  const keyHash = crypto.createHash("sha256").update(encryptKey).digest();
  const iv = buf.subarray(0, 16);
  const ciphertext = buf.subarray(16);
  const decipher = crypto.createDecipheriv("aes-256-cbc", keyHash, iv);
  let decrypted = decipher.update(ciphertext, undefined, "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// ── Route handler ─────────────────────────────────────────────────────────

class FeishuEventsTraceHandler {
  @Span("api.feishu.events.webhook_route.lookup", {
    tags: ([appId]) => ({
      channel_type: "feishu",
      app_id: appId,
    }),
  })
  async lookupWebhookRoute(appId: string) {
    return db
      .select()
      .from(webhookRoutes)
      .where(
        and(
          eq(webhookRoutes.channelType, "feishu"),
          eq(webhookRoutes.externalId, appId),
        ),
      );
  }

  @Span("api.feishu.events.gateway.forward", {
    tags: ([, accountId, poolId]) => ({
      channel_type: "feishu",
      account_id: accountId,
      pool_id: poolId,
    }),
  })
  async forwardToGateway(
    gatewayUrl: string,
    _accountId: string,
    _poolId: string,
    rawBody: string,
  ): Promise<Response> {
    return fetch(gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });
  }

  @Span("api.feishu.events.ingress", {
    tags: () => ({
      route: "/api/feishu/events",
      channel_type: "feishu",
    }),
  })
  async handle(c: Context<AppBindings>): Promise<Response> {
    try {
      let rawBody: string;
      try {
        rawBody = await c.req.text();
      } catch (err) {
        const unknownError = BaseError.from(err);
        logger.warn({
          message: "feishu_events_body_read_failed",
          scope: "feishu_events_body_read",
          ...unknownError.toJSON(),
        });
        return c.json({ ok: true });
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        logger.warn({ message: "feishu_events_invalid_json_body" });
        return c.json({ message: "Invalid JSON" }, 400);
      }

      // Handle encrypted events — decrypt first, then re-parse
      if (typeof payload.encrypt === "string") {
        // We need to find the verification token / encrypt key to decrypt.
        // Feishu v2 events may only contain { encrypt: "..." } at top level.
        // We try all known feishu webhook routes' encrypt keys.
        const feishuRoutes = await db
          .select({
            botChannelId: webhookRoutes.botChannelId,
            externalId: webhookRoutes.externalId,
          })
          .from(webhookRoutes)
          .where(eq(webhookRoutes.channelType, "feishu"));

        let decrypted = false;
        for (const route of feishuRoutes) {
          const [tokenRow] = await db
            .select({ encryptedValue: channelCredentials.encryptedValue })
            .from(channelCredentials)
            .where(
              and(
                eq(channelCredentials.botChannelId, route.botChannelId),
                eq(channelCredentials.credentialType, "verificationToken"),
              ),
            );
          if (!tokenRow) continue;

          try {
            const encryptKey = decrypt(tokenRow.encryptedValue);
            const plaintext = decryptFeishuEvent(
              payload.encrypt as string,
              encryptKey,
            );
            payload = JSON.parse(plaintext) as Record<string, unknown>;
            decrypted = true;
            break;
          } catch {
            // Try next key
          }
        }

        if (!decrypted) {
          logger.warn({ message: "feishu_events_decrypt_failed" });
          return c.json({ message: "Decryption failed" }, 400);
        }

        // Re-serialize for forwarding to gateway
        rawBody = JSON.stringify(payload);
      }

      // Handle url_verification challenge
      if (payload.type === "url_verification") {
        return c.json({ challenge: payload.challenge });
      }

      // Feishu v2 event schema: { schema: "2.0", header: {...}, event: {...} }
      const header = payload.header as Record<string, unknown> | undefined;
      const event = payload.event as Record<string, unknown> | undefined;

      if (!header || !event) {
        logger.warn({
          message: "feishu_events_missing_header_or_event",
          payload_type: payload.type,
        });
        return c.json({ ok: true });
      }

      const appId = header.app_id as string | undefined;
      const eventType = header.event_type as string | undefined;
      const eventId = header.event_id as string | undefined;

      if (!appId) {
        return c.json({ message: "Missing app_id in header" }, 400);
      }

      logger.info({
        message: "feishu_events_incoming",
        app_id: appId,
        event_type: eventType,
      });

      // Only handle message events
      if (eventType !== "im.message.receive_v1") {
        return c.json({ ok: true });
      }

      // Look up webhook route
      const [route] = await this.lookupWebhookRoute(appId);
      if (!route) {
        logger.warn({
          message: "feishu_events_webhook_route_missing",
          app_id: appId,
        });
        return c.json({ message: "Unknown app" }, 404);
      }

      const accountId = route.accountId ?? `feishu-${appId}`;

      // Extract sender info
      const sender = event.sender as Record<string, unknown> | undefined;
      const senderId = sender?.sender_id as Record<string, unknown> | undefined;
      const senderOpenId = senderId?.open_id as string | undefined;
      const senderType = sender?.sender_type as string | undefined;

      // Skip bot messages to prevent loops
      if (senderType === "app") {
        return c.json({ ok: true });
      }

      const message = event.message as Record<string, unknown> | undefined;
      const messageId = message?.message_id as string | undefined;
      const chatId = message?.chat_id as string | undefined;
      const chatType = message?.chat_type as string | undefined;

      // ====== Claim check (only if we have sender identity) ======
      if (senderOpenId && route.botId) {
        const workspaceKey = `feishu:${appId}`;
        const cacheKey = `${workspaceKey}:${senderOpenId}`;

        // Fast path: check cache for registered users
        let nexuUserId = getCachedUserId(cacheKey);

        if (!nexuUserId) {
          // Cache miss — hit DB
          const [membership] = await db
            .select({ userId: workspaceMemberships.userId })
            .from(workspaceMemberships)
            .where(
              and(
                eq(workspaceMemberships.workspaceKey, workspaceKey),
                eq(workspaceMemberships.imUserId, senderOpenId),
              ),
            );

          if (membership) {
            nexuUserId = membership.userId;
            setCachedUserId(cacheKey, nexuUserId);
          }
        }

        if (!nexuUserId) {
          // User not registered — send claim card and block message
          logger.info({
            message: "feishu_events_unclaimed_user_intercepted",
            app_id: appId,
            open_id: senderOpenId,
            event_type: eventType,
          });

          // Deduplicate claim card sending (DB-level, works across API pods)
          const dedupKey = eventId ?? `${appId}:${senderOpenId}:${Date.now()}`;
          if (await tryAcquireClaimLock(dedupKey)) {
            // Get credentials for sending
            const creds = await db
              .select({
                credentialType: channelCredentials.credentialType,
                encryptedValue: channelCredentials.encryptedValue,
              })
              .from(channelCredentials)
              .where(eq(channelCredentials.botChannelId, route.botChannelId));

            const credMap = new Map<string, string>();
            for (const cred of creds) {
              try {
                credMap.set(cred.credentialType, decrypt(cred.encryptedValue));
              } catch {
                // skip
              }
            }

            const feishuAppId = credMap.get("appId");
            const feishuAppSecret = credMap.get("appSecret");

            if (feishuAppId && feishuAppSecret) {
              const tenantToken = await getFeishuTenantToken(
                feishuAppId,
                feishuAppSecret,
              );
              if (tenantToken) {
                // Send a bind prompt card with a link to the OAuth bind page
                const webUrl = process.env.WEB_URL ?? "http://localhost:5173";
                const bindUrl = `${webUrl}/feishu/bind?ws=${encodeURIComponent(workspaceKey)}&bot=${encodeURIComponent(route.botId)}`;
                const card = buildFeishuBindPromptCard(bindUrl);

                if (chatType === "p2p") {
                  await sendFeishuCardMessage(
                    card,
                    senderOpenId,
                    tenantToken,
                    "open_id",
                    messageId,
                  );
                } else if (chatId) {
                  await sendFeishuCardMessage(
                    card,
                    chatId,
                    tenantToken,
                    "chat_id",
                    messageId,
                  );
                }

                logger.info({
                  message: "feishu_bind_prompt_sent",
                  scope: "feishu-events",
                  open_id: senderOpenId,
                  chat_type: chatType,
                  workspace_key: workspaceKey,
                });
              }
            }
          }

          // Block message from reaching agent
          return c.json({ ok: true });
        }

        // User is registered — upsert session (fire-and-forget)
        if (chatId) {
          const now = new Date().toISOString();
          const sessionKey = `feishu_${accountId}_${chatId}`
            .trim()
            .toLowerCase();

          db.insert(sessions)
            .values({
              id: createId(),
              botId: route.botId,
              sessionKey,
              channelType: "feishu",
              channelId: chatId,
              nexuUserId,
              title: chatType === "p2p" ? "Feishu DM" : `Feishu #${chatId}`,
              status: "active",
              messageCount: 1,
              lastMessageAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: sessions.sessionKey,
              set: {
                botId: route.botId,
                messageCount: sql`${sessions.messageCount} + 1`,
                lastMessageAt: now,
                nexuUserId: nexuUserId ?? sql`${sessions.nexuUserId}`,
                updatedAt: now,
              },
            })
            .catch((err) => {
              logger.warn({
                message: "feishu_events_session_upsert_failed",
                session_key: sessionKey,
                error: String(err),
              });
            });

          // Track channel participants for group chats
          if (chatType !== "p2p" && nexuUserId) {
            db.insert(sessionParticipants)
              .values({
                sessionKey,
                nexuUserId,
                imUserId: senderOpenId,
                firstSeenAt: now,
              })
              .onConflictDoNothing()
              .catch((err) => {
                logger.warn({
                  message: "feishu_events_participant_upsert_failed",
                  session_key: sessionKey,
                  error: String(err),
                });
              });
          }
        }
      }

      // ====== Forward to gateway ======
      const [pool] = await db
        .select({ podIp: gatewayPools.podIp })
        .from(gatewayPools)
        .where(eq(gatewayPools.id, route.poolId));

      const podIp = pool?.podIp;
      if (!podIp) {
        logger.warn({
          message: "feishu_events_gateway_pod_missing",
          app_id: appId,
          pool_id: route.poolId,
        });
        return c.json({ accepted: true }, 202);
      }

      const gatewayUrl = `http://${podIp}:18790/feishu/events/${accountId}`;
      logger.info({
        message: "feishu_events_forwarding",
        gateway_url: gatewayUrl,
        event_type: eventType,
      });

      try {
        const gatewayResp = await this.forwardToGateway(
          gatewayUrl,
          accountId,
          route.poolId,
          rawBody,
        );

        const respBody = await gatewayResp.text();
        logger.info({
          message: "feishu_events_gateway_response",
          event_type: eventType,
          status: gatewayResp.status,
          body_length: respBody.length,
        });
        return new Response(respBody, {
          status: gatewayResp.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        const unknownError = BaseError.from(err);
        logger.error({
          message: "feishu_events_gateway_forward_failed",
          scope: "feishu_events_gateway_forward",
          pool_id: route.poolId,
          account_id: accountId,
          event_type: eventType,
          ...unknownError.toJSON(),
        });
        return c.json({ accepted: true }, 202);
      }
    } catch (err) {
      const unknownError = BaseError.from(err);
      logger.warn({
        message: "feishu_events_unhandled_error",
        scope: "feishu_events_handler",
        ...unknownError.toJSON(),
      });
      return c.json({ ok: true });
    }
  }
}

// ── Card action callback handler (backward compatibility) ────────────────
// Legacy claim cards may still exist in chat history. This handler responds
// to old card button clicks with a toast message directing users to the
// new OAuth-based bind flow.

async function handleCardAction(c: Context<AppBindings>): Promise<Response> {
  try {
    const payload = (await c.req.json()) as Record<string, unknown>;

    // Handle url_verification challenge
    if (payload.type === "url_verification") {
      return c.json({ challenge: payload.challenge });
    }

    // Parse v1/v2 format to check if user is already registered
    const isV2 = payload.schema === "2.0";
    const event = isV2
      ? (payload.event as Record<string, unknown> | undefined)
      : undefined;
    const operator = event?.operator as Record<string, unknown> | undefined;
    const openId = isV2
      ? (operator?.open_id as string | undefined)
      : (payload.open_id as string | undefined);
    const action = isV2
      ? (event?.action as Record<string, unknown> | undefined)
      : (payload.action as Record<string, unknown> | undefined);
    const actionValue = action?.value as Record<string, unknown> | undefined;
    const workspaceKey = actionValue?.workspaceKey as string | undefined;

    if (openId && workspaceKey) {
      const [membership] = await db
        .select({ userId: workspaceMemberships.userId })
        .from(workspaceMemberships)
        .where(
          and(
            eq(workspaceMemberships.workspaceKey, workspaceKey),
            eq(workspaceMemberships.imUserId, openId),
          ),
        );

      if (membership) {
        return c.json({
          toast: {
            type: "success" as const,
            content: "你的飞书账号已绑定 Nexu，可以正常使用了。",
          },
        });
      }
    }

    return c.json({
      toast: {
        type: "info" as const,
        content: "请在 Nexu 网页端完成飞书账号绑定。",
      },
    });
  } catch (err) {
    const unknownError = BaseError.from(err);
    logger.warn({
      message: "feishu_card_action_error",
      scope: "feishu_card_action",
      ...unknownError.toJSON(),
    });
    return c.json({});
  }
}

export function registerFeishuEvents(app: OpenAPIHono<AppBindings>) {
  const traceHandler = new FeishuEventsTraceHandler();

  app.on("POST", "/api/feishu/events", async (c) => {
    return traceHandler.handle(c);
  });

  // Feishu card action callback — configured as "消息卡片请求网址" in Feishu console
  app.on("POST", "/api/feishu/card-action", handleCardAction);
}
