import crypto from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  botChannels,
  channelCredentials,
  gatewayPools,
  sessions,
  webhookRoutes,
} from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
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

export function registerSlackEvents(app: OpenAPIHono<AppBindings>) {
  app.on("POST", "/api/slack/events", async (c) => {
    try {
      console.log(
        `[slack-events] incoming: method=${c.req.method} content-type=${c.req.header("content-type")} retry=${c.req.header("x-slack-retry-num") ?? "none"}`,
      );

      // Skip Slack retries — we already processed the original
      if (c.req.header("x-slack-retry-num")) {
        return c.json({ ok: true });
      }

      // Read body — try Hono first, fall back to raw IncomingMessage
      let rawBody: string;
      try {
        rawBody = await c.req.text();
        if (!rawBody) {
          // Hono might have already consumed the body; try raw IncomingMessage
          const incoming = (c.env as { incoming: IncomingMessage }).incoming;
          rawBody = await readIncomingBody(incoming);
        }
        console.log(`[slack-events] body length=${rawBody.length}`);
      } catch (err) {
        console.error("[slack-events] Failed to read body:", err);
        return c.json({ ok: true });
      }

      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(rawBody) as Record<string, unknown>;
        const event = payload.event as Record<string, unknown> | undefined;
        console.log(
          `[slack-events] type=${payload.type} team=${payload.team_id} event.type=${event?.type ?? "none"} event.subtype=${event?.subtype ?? "none"} event.channel=${event?.channel ?? "none"} event.user=${event?.user ?? "none"} event.text=${typeof event?.text === "string" ? event.text.slice(0, 80) : "none"}`,
        );
      } catch {
        console.error("[slack-events] Invalid JSON body");
        return c.json({ error: "Invalid JSON" }, 400);
      }

      // Handle url_verification challenge (Slack endpoint validation)
      if (payload.type === "url_verification") {
        return c.json({ challenge: payload.challenge });
      }

      // Extract team_id and api_app_id from event payload
      const teamId = payload.team_id as string | undefined;
      if (!teamId) {
        return c.json({ error: "Missing team_id" }, 400);
      }

      const apiAppId = payload.api_app_id as string | undefined;
      if (!apiAppId) {
        return c.json({ error: "Missing api_app_id" }, 400);
      }

      // Look up webhook route using composite key (teamId:appId)
      const compositeKey = `${teamId}:${apiAppId}`;
      const [route] = await db
        .select()
        .from(webhookRoutes)
        .where(
          and(
            eq(webhookRoutes.channelType, "slack"),
            eq(webhookRoutes.externalId, compositeKey),
          ),
        );

      if (!route) {
        console.warn(`[slack-events] No webhook route for ${compositeKey}`);
        return c.json({ error: "Unknown workspace" }, 404);
      }

      // Retrieve signing secret from credentials
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
        console.error(
          `[slack-events] No signing secret for botChannelId=${route.botChannelId}`,
        );
        return c.json({ error: "Channel misconfigured" }, 500);
      }

      const signingSecret = decrypt(signingSecretRow.encryptedValue);

      // Verify Slack request signature
      const timestamp = c.req.header("x-slack-request-timestamp") ?? "";
      const signature = c.req.header("x-slack-signature") ?? "";

      if (!timestamp || !signature) {
        console.warn("[slack-events] Missing signature headers");
        return c.json({ error: "Missing Slack signature headers" }, 401);
      }

      if (!verifySlackSignature(signingSecret, timestamp, rawBody, signature)) {
        console.warn(
          `[slack-events] Signature mismatch: ts=${timestamp} sig=${signature.slice(0, 20)}...`,
        );
        return c.json({ error: "Invalid signature" }, 401);
      }

      // Find the gateway pod + botId
      const [channel] = await db
        .select({
          accountId: botChannels.accountId,
          botId: botChannels.botId,
        })
        .from(botChannels)
        .where(eq(botChannels.id, route.botChannelId));

      const accountId = channel?.accountId ?? `slack-${teamId}`;

      // Upsert session for message events (fire-and-forget)
      const event = payload.event as Record<string, unknown> | undefined;
      const isMessageEvent =
        event?.type === "message" || event?.type === "app_mention";
      if (isMessageEvent && channel?.botId && event?.channel) {
        const channelId = event.channel as string;
        const sessionKey = `slack_${teamId}_${channelId}`;
        const now = new Date().toISOString();

        // Resolve Slack channel name via bot token (best-effort)
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
                // DM — try to get user display name
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
            console.warn("[slack-events] Failed to resolve channel name:", err);
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
              title,
              messageCount: sql`${sessions.messageCount} + 1`,
              lastMessageAt: now,
              updatedAt: now,
            },
          })
          .then(() =>
            console.log(
              `[slack-events] session upserted: ${sessionKey} title="${title}"`,
            ),
          )
          .catch((err) =>
            console.error("[slack-events] session upsert failed:", err),
          );
      }

      const [pool] = await db
        .select({ podIp: gatewayPools.podIp })
        .from(gatewayPools)
        .where(eq(gatewayPools.id, route.poolId));

      const podIp = pool?.podIp;

      // Forward to gateway or log locally
      if (!podIp) {
        console.warn(
          `[slack-events] no active gateway pod for team_id=${teamId} pool_id=${route.poolId}`,
        );
        return c.json({ accepted: true }, 202);
      }

      // Forward to gateway pod
      const fwdEvent = payload.event as Record<string, unknown> | undefined;
      const gatewayUrl = `http://${podIp}:18789/slack/events/${accountId}`;
      console.log(
        `[slack-events] forwarding to ${gatewayUrl} event.type=${fwdEvent?.type ?? "none"} ts=${timestamp} sig=${signature.slice(0, 20)}...`,
      );

      try {
        const gatewayResp = await fetch(gatewayUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-slack-request-timestamp": timestamp,
            "x-slack-signature": signature,
          },
          body: rawBody,
        });

        const respBody = await gatewayResp.text();
        console.log(
          `[slack-events] gateway responded: event.type=${fwdEvent?.type ?? "none"} status=${gatewayResp.status} body=${respBody.slice(0, 200)}`,
        );
        return new Response(respBody, {
          status: gatewayResp.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.error("[slack-events] Failed to forward to gateway", {
          poolId: route.poolId,
          accountId,
          error: err instanceof Error ? err.message : "unknown_error",
        });
        return c.json({ accepted: true }, 202);
      }
    } catch (err) {
      console.error("[slack-events] Unhandled error:", err);
      return c.json({ ok: true });
    }
  });
}
