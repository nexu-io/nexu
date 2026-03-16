import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  channelCredentials,
  oauthStates,
  webhookRoutes,
  workspaceMemberships,
} from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
import { getFeishuTenantToken } from "../lib/feishu-webhook.js";
import { logger } from "../lib/logger.js";
import type { AppBindings } from "../types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getFeishuRedirectUri(): string {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return `${base}/oauth/feishu/callback`;
}

/** Look up Feishu app credentials via webhookRoutes + channelCredentials. */
async function getFeishuAppCredentials(appId: string): Promise<{
  appSecret: string;
  botChannelId: string;
} | null> {
  const [route] = await db
    .select({ botChannelId: webhookRoutes.botChannelId })
    .from(webhookRoutes)
    .where(
      and(
        eq(webhookRoutes.channelType, "feishu"),
        eq(webhookRoutes.externalId, appId),
      ),
    );

  if (!route) return null;

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
      // skip bad credentials
    }
  }

  const appSecret = credMap.get("appSecret");
  if (!appSecret) return null;

  return { appSecret, botChannelId: route.botChannelId };
}

// ---------------------------------------------------------------------------
// Route definitions
// ---------------------------------------------------------------------------

const feishuOAuthUrlRoute = createRoute({
  method: "get",
  path: "/api/v1/feishu/bind/oauth-url",
  tags: ["Feishu"],
  request: {
    query: z.object({
      workspaceKey: z.string().min(1),
      botId: z.string().min(1),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ url: z.string() }),
        },
      },
      description: "Feishu OAuth authorization URL",
    },
    400: {
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
      description: "Invalid workspace key",
    },
    404: {
      content: {
        "application/json": {
          schema: z.object({ message: z.string() }),
        },
      },
      description: "Feishu app not found",
    },
  },
});

// ---------------------------------------------------------------------------
// Authenticated route: generate Feishu OAuth URL
// ---------------------------------------------------------------------------

export function registerFeishuOAuthRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(feishuOAuthUrlRoute, async (c) => {
    const userId = c.get("userId");
    const { workspaceKey, botId } = c.req.valid("query");

    // Extract appId from workspaceKey (format: "feishu:{appId}")
    if (!workspaceKey.startsWith("feishu:")) {
      return c.json({ message: "Invalid workspace key format" }, 400);
    }
    const appId = workspaceKey.slice("feishu:".length);

    // Verify the Feishu app exists and get credentials
    const appCreds = await getFeishuAppCredentials(appId);
    if (!appCreds) {
      return c.json({ message: "Feishu app not found or not configured" }, 404);
    }

    // Check if already bound
    const [existing] = await db
      .select({ id: workspaceMemberships.id })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceKey, workspaceKey),
          eq(workspaceMemberships.userId, userId),
        ),
      );

    if (existing) {
      return c.json({ message: "Already bound to this workspace" }, 400);
    }

    // Create OAuth state (10 min TTL)
    const nonce = createId();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await db.insert(oauthStates).values({
      id: createId(),
      state: nonce,
      userId,
      botId,
      workspaceKey,
      expiresAt,
    });

    // Build Feishu OAuth URL
    const url = new URL("https://open.feishu.cn/open-apis/authen/v1/authorize");
    url.searchParams.set("app_id", appId);
    url.searchParams.set("redirect_uri", getFeishuRedirectUri());
    url.searchParams.set("state", nonce);

    return c.json({ url: url.toString() }, 200);
  });
}

// ---------------------------------------------------------------------------
// Unauthenticated route: Feishu OAuth callback (browser redirect)
// ---------------------------------------------------------------------------

export function registerFeishuOAuthCallback(app: OpenAPIHono<AppBindings>) {
  app.get("/oauth/feishu/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    const webUrl = process.env.WEB_URL ?? "http://localhost:5173";

    const redirectWithError = (msg: string) => {
      const url = new URL("/feishu/bind", webUrl);
      url.searchParams.set("error", msg);
      return c.redirect(url.toString(), 302);
    };

    if (!code || !state) {
      return redirectWithError("Missing authorization code or state parameter");
    }

    // --- 1. Validate state token ---
    const [stateRow] = await db
      .select()
      .from(oauthStates)
      .where(eq(oauthStates.state, state));

    if (!stateRow) {
      return redirectWithError("Invalid or expired authorization");
    }

    if (stateRow.usedAt) {
      return redirectWithError("This authorization link has already been used");
    }

    if (new Date(stateRow.expiresAt) < new Date()) {
      return redirectWithError("Authorization expired. Please try again.");
    }

    // --- 2. Mark state as used ---
    await db
      .update(oauthStates)
      .set({ usedAt: new Date().toISOString() })
      .where(eq(oauthStates.id, stateRow.id));

    const { userId, botId, workspaceKey } = stateRow;

    if (!workspaceKey || !botId) {
      return redirectWithError("Invalid OAuth state: missing context");
    }

    // --- 3. Get Feishu app credentials ---
    const appId = workspaceKey.slice("feishu:".length);
    const appCreds = await getFeishuAppCredentials(appId);
    if (!appCreds) {
      return redirectWithError("Feishu app not found");
    }

    // --- 4. Get app_access_token (tenant token) ---
    const appAccessToken = await getFeishuTenantToken(
      appId,
      appCreds.appSecret,
    );
    if (!appAccessToken) {
      return redirectWithError("Failed to get Feishu app token");
    }

    // --- 5. Exchange code for user access token + open_id ---
    let openId: string;
    try {
      const resp = await fetch(
        "https://open.feishu.cn/open-apis/authen/v1/access_token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${appAccessToken}`,
          },
          body: JSON.stringify({
            grant_type: "authorization_code",
            code,
          }),
        },
      );

      const data = (await resp.json()) as {
        code: number;
        msg?: string;
        data?: { open_id?: string; access_token?: string };
      };

      logger.info({
        message: "feishu_oauth_token_exchange_response",
        feishu_code: data.code,
        feishu_msg: data.msg,
        has_open_id: !!data.data?.open_id,
      });

      if (data.code !== 0 || !data.data?.open_id) {
        logger.warn({
          message: "feishu_oauth_token_exchange_failed",
          feishu_code: data.code,
          feishu_msg: data.msg,
        });
        return redirectWithError(
          `Feishu authorization failed: ${data.msg ?? "unknown error"}`,
        );
      }

      openId = data.data.open_id;
    } catch {
      return redirectWithError("Failed to communicate with Feishu");
    }

    logger.info({
      message: "feishu_oauth_identity_resolved",
      open_id: openId,
      workspace_key: workspaceKey,
      user_id: userId,
    });

    // --- 6. Check for conflicts ---
    // Check if this Nexu user already has a different IM identity in this workspace
    const [existingByUser] = await db
      .select({ imUserId: workspaceMemberships.imUserId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceKey, workspaceKey),
          eq(workspaceMemberships.userId, userId),
        ),
      );

    if (existingByUser && existingByUser.imUserId !== openId) {
      return redirectWithError(
        "This Nexu account is already linked to a different Feishu identity in this workspace",
      );
    }

    // Check if this Feishu identity is already claimed by a different Nexu user
    const [existingByIm] = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(
        and(
          eq(workspaceMemberships.workspaceKey, workspaceKey),
          eq(workspaceMemberships.imUserId, openId),
        ),
      );

    if (existingByIm && existingByIm.userId !== userId) {
      return redirectWithError(
        "This Feishu account is already linked to a different Nexu account",
      );
    }

    // --- 7. Create workspace membership ---
    await db
      .insert(workspaceMemberships)
      .values({
        id: createId(),
        workspaceKey,
        userId,
        botId,
        imUserId: openId,
        role: "member",
      })
      .onConflictDoNothing();

    logger.info({
      message: "feishu_oauth_bind_success",
      open_id: openId,
      workspace_key: workspaceKey,
      user_id: userId,
    });

    // --- 8. Redirect to success page ---
    const successUrl = new URL("/feishu/bind", webUrl);
    successUrl.searchParams.set("success", "true");
    successUrl.searchParams.set("ws", workspaceKey);
    return c.redirect(successUrl.toString(), 302);
  });
}
