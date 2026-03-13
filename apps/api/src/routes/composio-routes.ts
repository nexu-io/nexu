import crypto from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  composioDisconnectRequestSchema,
  composioExecuteRequestSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  bots,
  poolSecrets,
  supportedToolkits,
  userIntegrations,
} from "../db/schema/index.js";
import { buildAuthCards } from "../lib/auth-card-builder.js";
import {
  executeAction,
  initializeOAuthConnection,
  revokeConnection,
} from "../lib/composio.js";
import { decrypt } from "../lib/crypto.js";
import { requireSkillToken } from "../middleware/internal-auth.js";
import type { AppBindings } from "../types.js";

const ACTION_PREFIX_TO_TOOLKIT: Record<string, string> = {
  GMAIL: "gmail",
  GOOGLECALENDAR: "googlecalendar",
  SLACK: "slack",
  GOOGLEDOCS: "googledocs",
  GOOGLESHEETS: "googlesheets",
  GOOGLEDRIVE: "googledrive",
  GITHUB: "github",
  NOTION: "notion",
  LINEAR: "linear",
  JIRA: "jira",
  ASANA: "asana",
  TRELLO: "trello",
  AIRTABLE: "airtable",
  HUBSPOT: "hubspot",
  SALESFORCE: "salesforce",
  STRIPE: "stripe",
  SENDGRID: "sendgrid",
  MAILCHIMP: "mailchimp",
  ZOOM: "zoom",
  DROPBOX: "dropbox",
  FIGMA: "figma",
  CLICKUP: "clickup",
  MONDAY: "monday",
  ZENDESK: "zendesk",
  GOOGLEMEET: "googlemeet",
  GOOGLESLIDES: "googleslides",
  GOOGLETASKS: "googletasks",
};

export function resolveToolkitFromAction(action: string): string | undefined {
  // Try progressively shorter prefixes (longest match first)
  // e.g. GOOGLECALENDAR_CREATE_EVENT → GOOGLECALENDAR → found
  const parts = action.split("_");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join("");
    if (ACTION_PREFIX_TO_TOOLKIT[prefix]) {
      return ACTION_PREFIX_TO_TOOLKIT[prefix];
    }
  }
  // Also try each prefix segment joined with underscore removed
  // e.g. GOOGLE_CALENDAR → GOOGLECALENDAR
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join("_");
    if (ACTION_PREFIX_TO_TOOLKIT[prefix]) {
      return ACTION_PREFIX_TO_TOOLKIT[prefix];
    }
  }
  return undefined;
}

const errorResponseSchema = z.object({
  message: z.string(),
});

const authCardSchema = z.object({
  slack: z.string(),
  discord: z.string(),
  feishu: z.string(),
});

const notConnectedResponseSchema = z.object({
  message: z.string(),
  connectUrl: z.string().optional(),
  authCard: authCardSchema.optional(),
});

const executeResponseSchema = z.object({
  data: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
  successful: z.boolean(),
});

const executeRoute = createRoute({
  method: "post",
  path: "/api/internal/composio/execute",
  tags: ["Composio (Internal)"],
  request: {
    body: {
      content: {
        "application/json": { schema: composioExecuteRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: executeResponseSchema },
      },
      description: "Action execution result",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Unauthorized",
    },
    403: {
      content: { "application/json": { schema: notConnectedResponseSchema } },
      description: "Integration not connected",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Bot not found",
    },
    502: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Upstream service error",
    },
  },
});

const disconnectRoute = createRoute({
  method: "post",
  path: "/api/internal/composio/disconnect",
  tags: ["Composio (Internal)"],
  request: {
    body: {
      content: {
        "application/json": { schema: composioDisconnectRequestSchema },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: executeResponseSchema },
      },
      description: "Integration disconnected",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Unauthorized",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Bot or integration not found",
    },
  },
});

async function resolveComposioApiKey(
  poolId: string,
): Promise<string | undefined> {
  // Try DB first (pool secret), fall back to env var
  const [row] = await db
    .select({ encryptedValue: poolSecrets.encryptedValue })
    .from(poolSecrets)
    .where(
      and(
        eq(poolSecrets.poolId, poolId),
        eq(poolSecrets.secretName, "COMPOSIO_API_KEY"),
        eq(poolSecrets.scope, "pool"),
      ),
    )
    .limit(1);

  if (row) {
    try {
      return decrypt(row.encryptedValue);
    } catch {
      // Fall through to env var
    }
  }

  return process.env.COMPOSIO_API_KEY;
}

interface ConnectResult {
  redirectUrl: string;
  toolkit: {
    slug: string;
    displayName: string;
    description: string;
    domain: string;
  };
}

async function generateConnectUrl(
  composioApiKey: string,
  userId: string,
  toolkitSlug: string,
): Promise<ConnectResult | undefined> {
  try {
    // Verify the toolkit exists and is OAuth
    const [toolkit] = await db
      .select({
        slug: supportedToolkits.slug,
        displayName: supportedToolkits.displayName,
        description: supportedToolkits.description,
        domain: supportedToolkits.domain,
        authScheme: supportedToolkits.authScheme,
      })
      .from(supportedToolkits)
      .where(
        and(
          eq(supportedToolkits.slug, toolkitSlug),
          eq(supportedToolkits.enabled, true),
        ),
      )
      .limit(1);

    if (!toolkit || toolkit.authScheme !== "oauth2") {
      return undefined;
    }

    const now = new Date().toISOString();
    const oauthState = crypto.randomUUID();

    // Upsert integration row
    const [existing] = await db
      .select({ id: userIntegrations.id })
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.toolkitSlug, toolkitSlug),
        ),
      )
      .limit(1);

    let integrationId: string;
    if (existing) {
      integrationId = existing.id;
      await db
        .update(userIntegrations)
        .set({
          status: "initiated",
          oauthState,
          composioAccountId: null,
          source: "chat",
          updatedAt: now,
        })
        .where(eq(userIntegrations.id, existing.id));
    } else {
      integrationId = createId();
      await db.insert(userIntegrations).values({
        id: integrationId,
        userId,
        toolkitSlug,
        status: "initiated",
        oauthState,
        source: "chat",
        createdAt: now,
        updatedAt: now,
      });
    }

    const result = await initializeOAuthConnection(
      composioApiKey,
      toolkitSlug,
      userId,
      oauthState,
      integrationId,
    );
    return {
      redirectUrl: result.redirectUrl,
      toolkit: {
        slug: toolkit.slug,
        displayName: toolkit.displayName,
        description: toolkit.description,
        domain: toolkit.domain,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(
      `[composio] generateConnectUrl failed: toolkit=${toolkitSlug} user=${userId} error=${detail}`,
    );
    return undefined;
  }
}

export function registerComposioRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(executeRoute, async (c) => {
    requireSkillToken(c);
    const { botId, action, params } = c.req.valid("json");

    // 1. Resolve bot ownership + pool
    const [bot] = await db
      .select({ userId: bots.userId, poolId: bots.poolId })
      .from(bots)
      .where(eq(bots.id, botId))
      .limit(1);

    if (!bot) {
      return c.json({ message: "Bot not found" }, 404);
    }

    // 2. Resolve Composio API key from pool secrets
    const composioApiKey = bot.poolId
      ? await resolveComposioApiKey(bot.poolId)
      : process.env.COMPOSIO_API_KEY;

    if (!composioApiKey) {
      return c.json(
        {
          message:
            "Integration service not configured (missing COMPOSIO_API_KEY)",
        },
        502,
      );
    }

    // 3. Derive toolkit from action prefix
    const toolkitSlug = resolveToolkitFromAction(action);
    if (!toolkitSlug) {
      return c.json({ message: `Unknown toolkit for action: ${action}` }, 400);
    }

    // 4. Verify integration is connected
    const [integration] = await db
      .select({
        composioAccountId: userIntegrations.composioAccountId,
        status: userIntegrations.status,
      })
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, bot.userId),
          eq(userIntegrations.toolkitSlug, toolkitSlug),
        ),
      )
      .limit(1);

    if (!integration || integration.status !== "active") {
      const connectResult = await generateConnectUrl(
        composioApiKey,
        bot.userId,
        toolkitSlug,
      );
      return c.json(
        {
          message: `User has not connected ${toolkitSlug}.`,
          connectUrl: connectResult?.redirectUrl,
          authCard: connectResult
            ? buildAuthCards(connectResult.toolkit, connectResult.redirectUrl)
            : undefined,
        },
        403,
      );
    }

    if (!integration.composioAccountId) {
      const connectResult = await generateConnectUrl(
        composioApiKey,
        bot.userId,
        toolkitSlug,
      );
      return c.json(
        {
          message: `Integration for ${toolkitSlug} is missing account credentials. Please reconnect.`,
          connectUrl: connectResult?.redirectUrl,
          authCard: connectResult
            ? buildAuthCards(connectResult.toolkit, connectResult.redirectUrl)
            : undefined,
        },
        403,
      );
    }

    // 5. Execute via Composio SDK
    try {
      const result = await executeAction(
        composioApiKey,
        integration.composioAccountId,
        bot.userId,
        action,
        params,
      );
      const response: {
        data?: Record<string, unknown>;
        error?: string;
        successful: boolean;
      } = { successful: result.successful };
      if (result.data !== null && result.data !== undefined) {
        response.data =
          typeof result.data === "object" && !Array.isArray(result.data)
            ? (result.data as Record<string, unknown>)
            : { value: result.data };
      }
      if (result.error) {
        response.error = result.error;
      }
      return c.json(response, 200);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Unknown error";
      console.error(
        `[composio] execute failed: action=${action} bot=${botId} error=${detail}`,
      );
      return c.json({ message: "Failed to execute action" }, 502);
    }
  });

  app.openapi(disconnectRoute, async (c) => {
    requireSkillToken(c);
    const { botId, toolkitSlug } = c.req.valid("json");

    // 1. Resolve bot ownership
    const [bot] = await db
      .select({ userId: bots.userId, poolId: bots.poolId })
      .from(bots)
      .where(eq(bots.id, botId))
      .limit(1);

    if (!bot) {
      return c.json({ message: "Bot not found" }, 404);
    }

    // 2. Find integration
    const [integration] = await db
      .select({
        id: userIntegrations.id,
        status: userIntegrations.status,
        composioAccountId: userIntegrations.composioAccountId,
      })
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, bot.userId),
          eq(userIntegrations.toolkitSlug, toolkitSlug),
        ),
      )
      .limit(1);

    if (!integration) {
      return c.json(
        { message: `No integration found for ${toolkitSlug}` },
        404,
      );
    }

    if (integration.status === "disconnected") {
      return c.json(
        {
          successful: true,
          data: { message: `${toolkitSlug} is already disconnected.` },
        },
        200,
      );
    }

    // 3. Revoke and disconnect
    if (integration.composioAccountId) {
      await revokeConnection(integration.composioAccountId);
    }

    const now = new Date().toISOString();
    await db
      .update(userIntegrations)
      .set({
        status: "disconnected",
        disconnectedAt: now,
        composioAccountId: null,
        oauthState: null,
        updatedAt: now,
      })
      .where(eq(userIntegrations.id, integration.id));

    return c.json(
      {
        successful: true,
        data: {
          message: `Successfully disconnected ${toolkitSlug}. The user will need to re-authorize to use it again.`,
        },
      },
      200,
    );
  });
}
