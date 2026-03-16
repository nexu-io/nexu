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
  sessionParticipants,
  sessions,
  webhookRoutes,
  workspaceMemberships,
} from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
import { BaseError } from "../lib/error.js";
import { logger } from "../lib/logger.js";
import {
  getDecryptedBotToken,
  sendSlackEphemeral,
  sendSlackMessage,
} from "../lib/slack-api.js";
import { buildClaimCardBlocks } from "../lib/slack-blocks.js";
import { Span } from "../lib/trace-decorator.js";
import { publishPoolConfigSnapshot } from "../services/runtime/pool-config-service.js";
import type { AppBindings } from "../types.js";
import { generateClaimToken } from "./claim-routes.js";

export function buildSlackSessionKey(params: {
  botId: string;
  channelId: string;
  threadTs?: string | null;
  isIm: boolean;
  slackUserId?: string;
}): string {
  const botId = params.botId.trim().toLowerCase();
  const channelId = params.channelId.trim().toLowerCase();
  const threadTs = params.threadTs?.trim().toLowerCase();

  let baseKey: string;
  if (params.isIm) {
    const peerId = (params.slackUserId ?? "unknown").trim().toLowerCase();
    baseKey = `agent:${botId}:direct:${peerId}`;
  } else {
    baseKey = `agent:${botId}:slack:channel:${channelId}`;
  }

  return threadTs ? `${baseKey}:thread:${threadTs}` : baseKey;
}

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
          channelConfig: botChannels.channelConfig,
        })
        .from(botChannels)
        .where(eq(botChannels.id, route.botChannelId));

      // Parse channelConfig to check if this is a shared app
      let isSharedApp = false;
      try {
        const config = JSON.parse(channel?.channelConfig ?? "{}") as {
          isShared?: boolean;
        };
        isSharedApp = config.isShared === true;
      } catch {
        // Invalid JSON, treat as non-shared
      }

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

          // Clean up workspace memberships for this workspace
          const workspaceKey = `slack:${teamId}`;
          await db
            .delete(workspaceMemberships)
            .where(eq(workspaceMemberships.workspaceKey, workspaceKey));

          logger.info({
            message: "slack_events_workspace_members_cleared",
            workspace_key: workspaceKey,
          });
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

      // ====== Unclaimed user hard interception (shared app only) ======
      // Only intercept for shared Slack app, skip for user's own apps
      if (!isSharedApp) {
        // User's own app — no claim interception, pass through to gateway
      } else {
        // Skip bot messages to prevent infinite loops (bot sends claim card → triggers message event → sends again)
        if (event?.bot_id || event?.subtype === "bot_message") {
          return c.json({ ok: true });
        }

        const senderSlackUserId = event?.user as string | undefined;
        const isUserMessageEvent =
          senderSlackUserId &&
          (eventType === "message" || eventType === "app_mention");

        if (isUserMessageEvent && channel?.botId) {
          const workspaceKey = `slack:${teamId}`;

          const [membership] = await db
            .select({ userId: workspaceMemberships.userId })
            .from(workspaceMemberships)
            .where(
              and(
                eq(workspaceMemberships.workspaceKey, workspaceKey),
                eq(workspaceMemberships.imUserId, senderSlackUserId),
              ),
            );

          if (!membership) {
            logger.info({
              message: "slack_events_unclaimed_user_intercepted",
              team_id: teamId,
              slack_user_id: senderSlackUserId,
              event_type: eventType,
            });

            const botToken = await getDecryptedBotToken(route.botChannelId);
            if (!botToken) {
              logger.error({
                message: "slack_events_no_bot_token_for_claim",
                bot_channel_id: route.botChannelId,
              });
              return c.json({ ok: true });
            }

            const claimResult = await generateClaimToken({
              workspaceKey,
              imUserId: senderSlackUserId,
              botId: route.botId ?? channel.botId,
            });

            const msgChannelId = event?.channel as string;

            // Check if DM via conversations.info
            let isImChannel = false;
            try {
              const infoResp = await fetch(
                `https://slack.com/api/conversations.info?channel=${msgChannelId}`,
                { headers: { Authorization: `Bearer ${botToken}` } },
              );
              const infoData = (await infoResp.json()) as {
                ok: boolean;
                channel?: { is_im?: boolean };
              };
              isImChannel = infoData.ok && infoData.channel?.is_im === true;
            } catch {
              // Default to non-IM if lookup fails
            }

            const blocks = buildClaimCardBlocks(claimResult.claimUrl);
            const fallbackText =
              "Welcome to Nexu! Set up your account to get started.";

            if (isImChannel) {
              await sendSlackMessage({
                botToken,
                channel: msgChannelId,
                text: fallbackText,
                blocks,
              });
            } else {
              await sendSlackEphemeral({
                botToken,
                channel: msgChannelId,
                user: senderSlackUserId,
                text: fallbackText,
                blocks,
              });
            }

            return c.json({ ok: true });
          }
        }
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
        const now = new Date().toISOString();
        let isIm = false;

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
              isIm = infoData.channel.is_im === true;
              if (infoData.channel.is_im) {
                const eventUserId =
                  typeof event.user === "string" ? event.user : null;
                const userId = infoData.channel.user ?? eventUserId;
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

        const senderUserId = event?.user as string | undefined;

        const sessionKey = buildSlackSessionKey({
          botId: channel.botId,
          channelId,
          threadTs,
          isIm,
          slackUserId: senderUserId,
        });

        // Resolve nexuUserId for all message events (DM + channel)
        let nexuUserId: string | null = null;
        if (senderUserId) {
          const [membership] = await db
            .select({ userId: workspaceMemberships.userId })
            .from(workspaceMemberships)
            .where(
              and(
                eq(workspaceMemberships.workspaceKey, `slack:${teamId}`),
                eq(workspaceMemberships.imUserId, senderUserId),
              ),
            );
          nexuUserId = membership?.userId ?? null;
        }

        const title =
          channelName === channelId ? `Slack #${channelId}` : `#${channelName}`;

        // Skip session upsert for DM messages without a sender (bot echoes, message_changed, etc.)
        // to avoid creating "direct:unknown" sessions
        if (isIm && !senderUserId) {
          logger.info({
            message: "slack_events_skip_dm_session_no_sender",
            event_type: event?.type,
            event_subtype: event?.subtype,
            channel_id: channelId,
          });
          // Fall through to gateway forwarding without session upsert
        } else {
          db.insert(sessions)
            .values({
              id: createId(),
              botId: channel.botId,
              sessionKey,
              channelType: "slack",
              channelId,
              nexuUserId,
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
                nexuUserId: nexuUserId ?? sql`${sessions.nexuUserId}`,
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

          // Track channel participants for session visibility
          if (!isIm && nexuUserId && senderUserId) {
            db.insert(sessionParticipants)
              .values({
                sessionKey,
                nexuUserId,
                imUserId: senderUserId,
                firstSeenAt: now,
              })
              .onConflictDoNothing()
              .catch((err) => {
                logger.warn({
                  message: "slack_events_participant_upsert_failed",
                  session_key: sessionKey,
                  nexu_user_id: nexuUserId,
                  error: String(err),
                });
              });
          }
        } // end else (skip DM no sender)
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
          operation: "slack_event_gateway_forward",
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
        logger.error({
          message: "slack_events_gateway_forward_failed",
          operation: "slack_event_gateway_forward",
          status: "error",
          scope: "slack_events_gateway_forward",
          pool_id: route.poolId,
          account_id: accountId,
          event_type: fwdEvent?.type ?? "none",
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
