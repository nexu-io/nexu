import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import type { Context } from "hono";
import { db } from "../db/index.js";
import {
  botChannels,
  channelCredentials,
  gatewayPools,
  sessions,
  webhookRoutes,
} from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
import { BaseError } from "../lib/error.js";
import { logger } from "../lib/logger.js";
import { Span } from "../lib/trace-decorator.js";
import { publishPoolConfigSnapshot } from "../services/runtime/pool-config-service.js";
import type { AppBindings } from "../types.js";

// ── Read body from Node.js IncomingMessage (bypasses Hono body reading) ──

function readIncomingBody(incoming: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    incoming.on("error", reject);
  });
}

// ── Slack signature verification ──────────────────────────────────────────

function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (Number.parseInt(timestamp, 10) < fiveMinutesAgo) return false;

  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(sigBasestring)
    .digest("hex");
  const expected = `v0=${hmac}`;

  if (signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

// ── Route registration ────────────────────────────────────────────────────

class SlackEventsTraceHandler {
  @Span("api.slack.events.webhook_route.lookup", {
    tags: ([compositeKey]) => ({
      channel_type: "slack",
      composite_key: compositeKey,
    }),
  })
  async lookupWebhookRoute(compositeKey: string) {
    return db
      .select()
      .from(webhookRoutes)
      .where(
        and(
          eq(webhookRoutes.channelType, "slack"),
          eq(webhookRoutes.externalId, compositeKey),
        ),
      );
  }

  @Span("api.slack.events.gateway.forward", {
    tags: ([, accountId, poolId]) => ({
      channel_type: "slack",
      account_id: accountId,
      pool_id: poolId,
    }),
  })
  async forwardToGateway(
    gatewayUrl: string,
    _accountId: string,
    _poolId: string,
    rawBody: string,
    timestamp: string,
    signature: string,
  ): Promise<Response> {
    return fetch(gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-slack-request-timestamp": timestamp,
        "x-slack-signature": signature,
      },
      body: rawBody,
    });
  }

  @Span("api.slack.events.ingress", {
    tags: () => ({
      route: "/api/slack/events",
      channel_type: "slack",
    }),
  })
  async handle(c: Context<AppBindings>): Promise<Response> {
    try {
      logger.info({
        message: "slack_events_incoming",
        method: c.req.method,
        content_type: c.req.header("content-type") ?? "unknown",
        is_retry: Boolean(c.req.header("x-slack-retry-num")),
      });

      if (c.req.header("x-slack-retry-num")) {
        return c.json({ ok: true });
      }

      let rawBody: string;
      try {
        rawBody = await c.req.text();
        if (!rawBody) {
          const incoming = (c.env as { incoming: IncomingMessage }).incoming;
          rawBody = await readIncomingBody(incoming);
        }
        logger.info({
          message: "slack_events_body_read",
          body_length: rawBody.length,
        });
      } catch (err) {
        const unknownError = BaseError.from(err);
        logger.warn({
          message: "slack_events_body_read_failed",
          scope: "slack_events_body_read",
          ...unknownError.toJSON(),
        });
        return c.json({ ok: true });
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
        const event = payload.event as Record<string, unknown> | undefined;
        logger.info({
          message: "slack_events_payload_parsed",
          payload_type: payload.type,
          team_id: payload.team_id,
          event_type: event?.type ?? "none",
          event_subtype: event?.subtype ?? "none",
          event_channel: event?.channel ?? "none",
          event_user: event?.user ?? "none",
        });
      } catch {
        logger.warn({ message: "slack_events_invalid_json_body" });
        return c.json({ message: "Invalid JSON" }, 400);
      }

      if (payload.type === "url_verification") {
        return c.json({ challenge: payload.challenge });
      }

      const teamId = payload.team_id as string | undefined;
      if (!teamId) {
        return c.json({ message: "Missing team_id" }, 400);
      }

      const apiAppId = payload.api_app_id as string | undefined;
      if (!apiAppId) {
        return c.json({ message: "Missing api_app_id" }, 400);
      }

      const compositeKey = `${teamId}:${apiAppId}`;
      const [route] = await this.lookupWebhookRoute(compositeKey);

      if (!route) {
        logger.warn({
          message: "slack_events_webhook_route_missing",
          composite_key: compositeKey,
        });
        return c.json({ message: "Unknown workspace" }, 404);
      }

      const [signingSecretRow] = await db
        .select({ encryptedValue: channelCredentials.encryptedValue })
        .from(channelCredentials)
        .where(
          and(
            eq(channelCredentials.botChannelId, route.botChannelId),
            eq(channelCredentials.credentialType, "signingSecret"),
          ),
        );

      if (!signingSecretRow) {
        logger.error({
          message: "slack_events_signing_secret_missing",
          bot_channel_id: route.botChannelId,
        });
        return c.json({ message: "Channel misconfigured" }, 500);
      }

      const signingSecret = decrypt(signingSecretRow.encryptedValue);
      const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
      const signature = c.req.header("x-slack-signature") ?? "";

      if (!timestamp || !signature) {
        logger.warn({ message: "slack_events_signature_headers_missing" });
        return c.json({ message: "Missing Slack signature headers" }, 401);
      }

      if (!verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
        logger.warn({
          message: "slack_events_signature_mismatch",
          timestamp,
        });
        return c.json({ message: "Invalid signature" }, 401);
      }

      const [channel] = await db
        .select({
          accountId: botChannels.accountId,
          botId: botChannels.botId,
        })
        .from(botChannels)
        .where(eq(botChannels.id, route.botChannelId));

      const accountId = channel?.accountId ?? `slack-${apiAppId}-${teamId}`;

      // Handle token lifecycle events — prevent invalid tokens from crashing the gateway
      const event = payload.event as Record<string, unknown> | undefined;
      const eventType = event?.type as string | undefined;

      if (eventType === "tokens_revoked" || eventType === "app_uninstalled") {
        const newStatus =
          eventType === "app_uninstalled" ? "disconnected" : "error";
        logger.info({
          message: "slack_events_token_lifecycle",
          event_type: eventType,
          team_id: teamId,
          api_app_id: apiAppId,
          bot_channel_id: route.botChannelId,
          new_status: newStatus,
        });

        await db
          .update(botChannels)
          .set({ status: newStatus, updatedAt: new Date().toISOString() })
          .where(eq(botChannels.id, route.botChannelId));

        if (eventType === "app_uninstalled") {
          await db
            .delete(webhookRoutes)
            .where(eq(webhookRoutes.botChannelId, route.botChannelId));
        }

        // Trigger config reload so the gateway drops the dead account
        publishPoolConfigSnapshot(db, route.poolId).catch((err) => {
          logger.warn({
            message: "slack_events_config_republish_failed",
            pool_id: route.poolId,
            error: String(err),
          });
        });

        return c.json({ ok: true });
      }

      // Upsert session for message events (fire-and-forget)
      const isMessageEvent =
        event?.type === "message" || event?.type === "app_mention";
      if (isMessageEvent && channel?.botId && event?.channel) {
        const channelId = event.channel as string;
        const threadTs =
          typeof event.thread_ts === "string" && event.thread_ts.length > 0
            ? event.thread_ts
            : null;
        const scope = threadTs ? "thread" : "channel";
        const scopeId = threadTs ?? channelId;
        const sessionKey = `agent:${channel.botId}:slack:${scope}:${scopeId}`;
        const now = new Date().toISOString();

        let channelName = channelId;
        const [botTokenRow] = await db
          .select({ encryptedValue: channelCredentials.encryptedValue })
          .from(channelCredentials)
          .where(
            and(
              eq(channelCredentials.botChannelId, route.botChannelId),
              eq(channelCredentials.credentialType, "botToken"),
            ),
          );
        if (botTokenRow) {
          try {
            const botToken = decrypt(botTokenRow.encryptedValue);
            const infoResp = await fetch(
              `https://slack.com/api/conversations.info?channel=${channelId}`,
              { headers: { Authorization: `Bearer ${botToken}` } },
            );
            const infoData = (await infoResp.json()) as {
              ok: boolean;
              channel?: { name?: string; is_im?: boolean; user?: string };
            };
            if (infoData.ok && infoData.channel) {
              if (infoData.channel.is_im) {
                const userId = infoData.channel.user;
                if (userId) {
                  const userResp = await fetch(
                    `https://slack.com/api/users.info?user=${userId}`,
                    { headers: { Authorization: `Bearer ${botToken}` } },
                  );
                  const userData = (await userResp.json()) as {
                    ok: boolean;
                    user?: {
                      real_name?: string;
                      profile?: { display_name?: string };
                    };
                  };
                  if (userData.ok && userData.user) {
                    channelName =
                      userData.user.profile?.display_name ||
                      userData.user.real_name ||
                      channelId;
                  }
                }
              } else {
                channelName = infoData.channel.name ?? channelId;
              }
            }
          } catch (err) {
            const unknownError = BaseError.from(err);
            logger.warn({
              message: "slack_events_channel_name_resolve_failed",
              scope: "slack_events_channel_name_resolve",
              bot_channel_id: route.botChannelId,
              ...unknownError.toJSON(),
            });
          }
        }

        const title =
          channelName === channelId ? `Slack #${channelId}` : `#${channelName}`;

        db.insert(sessions)
          .values({
            id: createId(),
            botId: channel.botId,
            sessionKey,
            channelType: "slack",
            channelId,
            title,
            status: "active",
            messageCount: 1,
            lastMessageAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: sessions.sessionKey,
            set: {
              botId: channel.botId,
              title,
              messageCount: sql`${sessions.messageCount} + 1`,
              lastMessageAt: now,
              updatedAt: now,
            },
          })
          .then(() => {
            logger.info({
              message: "slack_events_session_upserted",
              session_key: sessionKey,
              title,
            });
          })
          .catch((err) => {
            const unknownError = BaseError.from(err);
            logger.warn({
              message: "slack_events_session_upsert_failed",
              scope: "slack_events_session_upsert",
              session_key: sessionKey,
              ...unknownError.toJSON(),
            });
          });
      }

      const [pool] = await db
        .select({ podIp: gatewayPools.podIp })
        .from(gatewayPools)
        .where(eq(gatewayPools.id, route.poolId));

      const podIp = pool?.podIp;
      if (!podIp) {
        logger.warn({
          message: "slack_events_gateway_pod_missing",
          team_id: teamId,
          pool_id: route.poolId,
        });
        return c.json({ accepted: true }, 202);
      }

      const fwdEvent = payload.event as Record<string, unknown> | undefined;
      const gatewayUrl = `http://${podIp}:18789/slack/events/${accountId}`;
      logger.info({
        message: "slack_events_forwarding",
        gateway_url: gatewayUrl,
        event_type: fwdEvent?.type ?? "none",
        timestamp,
      });

      try {
        const gatewayResp = await this.forwardToGateway(
          gatewayUrl,
          accountId,
          route.poolId,
          rawBody,
          timestamp,
          signature,
        );

        const respBody = await gatewayResp.text();
        logger.info({
          message: "slack_events_gateway_response",
          event_type: fwdEvent?.type ?? "none",
          status: gatewayResp.status,
          body_length: respBody.length,
        });
        return new Response(respBody, {
          status: gatewayResp.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        const unknownError = BaseError.from(err);
        logger.warn({
          message: "slack_events_gateway_forward_failed",
          scope: "slack_events_gateway_forward",
          pool_id: route.poolId,
          account_id: accountId,
          ...unknownError.toJSON(),
        });
        return c.json({ accepted: true }, 202);
      }
    } catch (err) {
      const unknownError = BaseError.from(err);
      logger.warn({
        message: "slack_events_unhandled_error",
        scope: "slack_events_handler",
        ...unknownError.toJSON(),
      });
      return c.json({ ok: true });
    }
  }
}

export function registerSlackEvents(app: OpenAPIHono<AppBindings>) {
  const traceHandler = new SlackEventsTraceHandler();

  app.on("POST", "/api/slack/events", async (c) => {
    return traceHandler.handle(c);
  });
}
