import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  connectIntegrationResponseSchema,
  connectIntegrationSchema,
  integrationListResponseSchema,
  integrationResponseSchema,
  refreshIntegrationSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  bots,
  integrationCredentials,
  poolSecrets,
  supportedToolkits,
  userIntegrations,
} from "../db/schema/index.js";
import {
  checkOAuthStatus,
  initializeOAuthConnection,
  maskCredential,
  revokeConnection,
  validateCredentialFields,
} from "../lib/composio.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const integrationIdParam = z.object({
  integrationId: z.string(),
});

const PNG_ICON_SLUGS = new Set(["jina", "excel"]);

function getToolkitIconUrl(slug: string): string {
  const ext = PNG_ICON_SLUGS.has(slug) ? "png" : "svg";
  return `/toolkit-icons/${slug}.${ext}`;
}

function getToolkitFallbackIconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
}

// --- Routes ---

const listIntegrationsRoute = createRoute({
  method: "get",
  path: "/api/v1/integrations",
  tags: ["Integrations"],
  responses: {
    200: {
      content: {
        "application/json": { schema: integrationListResponseSchema },
      },
      description: "List of integrations with user status",
    },
  },
});

const connectIntegrationRoute = createRoute({
  method: "post",
  path: "/api/v1/integrations/connect",
  tags: ["Integrations"],
  request: {
    body: {
      content: { "application/json": { schema: connectIntegrationSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: connectIntegrationResponseSchema },
      },
      description: "Connection initiated",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Toolkit not found",
    },
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "User bot context is ambiguous",
    },
    502: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Integration service not configured",
    },
  },
});

const refreshIntegrationRoute = createRoute({
  method: "post",
  path: "/api/v1/integrations/{integrationId}/refresh",
  tags: ["Integrations"],
  request: {
    params: integrationIdParam,
    body: {
      content: { "application/json": { schema: refreshIntegrationSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: integrationResponseSchema },
      },
      description: "Integration status refreshed",
    },
    400: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Invalid request",
    },
    403: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "State verification failed",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Integration not found",
    },
    409: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "User bot context is ambiguous",
    },
    502: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Integration service not configured",
    },
  },
});

const deleteIntegrationRoute = createRoute({
  method: "delete",
  path: "/api/v1/integrations/{integrationId}",
  tags: ["Integrations"],
  request: {
    params: integrationIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: integrationResponseSchema },
      },
      description: "Integration disconnected",
    },
    403: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Cannot disconnect global toolkit",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Integration not found",
    },
  },
});

// --- Helpers ---

type AuthField = {
  key: string;
  label: string;
  type: "text" | "secret";
  placeholder?: string;
};

type ToolkitRow = typeof supportedToolkits.$inferSelect;

function parseAuthFields(raw: string | null): AuthField[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AuthField[];
  } catch {
    return [];
  }
}

function buildToolkitInfo(toolkit: ToolkitRow) {
  const authFields = parseAuthFields(toolkit.authFields);
  return {
    slug: toolkit.slug,
    displayName: toolkit.displayName,
    description: toolkit.description,
    iconUrl: getToolkitIconUrl(toolkit.slug),
    fallbackIconUrl: getToolkitFallbackIconUrl(toolkit.domain),
    category: toolkit.category ?? "office",
    authScheme: toolkit.authScheme as
      | "oauth2"
      | "api_key_global"
      | "api_key_user",
    authFields: authFields.length > 0 ? authFields : undefined,
  };
}

function buildFallbackToolkitInfo(slug: string) {
  return {
    slug,
    displayName: slug,
    description: "",
    iconUrl: getToolkitIconUrl(slug),
    fallbackIconUrl: getToolkitFallbackIconUrl(""),
    category: "office",
    authScheme: "oauth2" as const,
  };
}

type ComposioUserContext =
  | {
      ok: true;
      apiKey: string;
      botId: string;
      poolId: string;
    }
  | {
      ok: false;
      status: 400 | 409 | 502;
      message: string;
    };

async function resolveComposioUserContext(
  userId: string,
): Promise<ComposioUserContext> {
  const userBots = await db
    .select({ id: bots.id, poolId: bots.poolId })
    .from(bots)
    .where(
      and(
        eq(bots.userId, userId),
        or(eq(bots.status, "active"), eq(bots.status, "paused")),
      ),
    );

  if (userBots.length === 0) {
    return {
      ok: false,
      status: 400,
      message:
        "Composio integrations require exactly one active or paused bot for this user",
    };
  }

  if (userBots.length > 1) {
    return {
      ok: false,
      status: 409,
      message:
        "Composio integrations are only supported for users with a single bot",
    };
  }

  const bot = userBots[0];
  if (!bot) {
    return {
      ok: false,
      status: 400,
      message:
        "Composio integrations require exactly one active or paused bot for this user",
    };
  }
  if (!bot.poolId) {
    return {
      ok: false,
      status: 400,
      message:
        "Composio integrations require the user's bot to be assigned to a pool",
    };
  }

  const [row] = await db
    .select({ encryptedValue: poolSecrets.encryptedValue })
    .from(poolSecrets)
    .where(
      and(
        eq(poolSecrets.poolId, bot.poolId),
        eq(poolSecrets.secretName, "COMPOSIO_API_KEY"),
        eq(poolSecrets.scope, "pool"),
      ),
    )
    .limit(1);

  let apiKey = process.env.COMPOSIO_API_KEY;
  if (row) {
    try {
      apiKey = decrypt(row.encryptedValue);
    } catch {
      apiKey = process.env.COMPOSIO_API_KEY;
    }
  }

  if (!apiKey) {
    return {
      ok: false,
      status: 502,
      message: "Integration service not configured (missing COMPOSIO_API_KEY)",
    };
  }

  return { ok: true, apiKey, botId: bot.id, poolId: bot.poolId };
}

async function getCredentialHints(
  integrationId: string,
): Promise<Record<string, string> | undefined> {
  const creds = await db
    .select({
      credentialKey: integrationCredentials.credentialKey,
      encryptedValue: integrationCredentials.encryptedValue,
    })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.integrationId, integrationId));

  if (creds.length === 0) return undefined;

  const hints: Record<string, string> = {};
  for (const cred of creds) {
    const decrypted = decrypt(cred.encryptedValue);
    hints[cred.credentialKey] = maskCredential(decrypted);
  }
  return hints;
}

// --- Handler registration ---

export function registerIntegrationRoutes(app: OpenAPIHono<AppBindings>) {
  // GET /api/v1/integrations
  app.openapi(listIntegrationsRoute, async (c) => {
    const userId = c.get("userId");

    const toolkits = await db
      .select()
      .from(supportedToolkits)
      .where(eq(supportedToolkits.enabled, true))
      .orderBy(supportedToolkits.sortOrder);

    const userRows = await db
      .select()
      .from(userIntegrations)
      .where(eq(userIntegrations.userId, userId));

    const userMap = new Map(userRows.map((r) => [r.toolkitSlug, r]));

    // Check for global credentials
    const globalSlugs = toolkits
      .filter((t) => t.authScheme === "api_key_global")
      .map((t) => t.slug);

    const globalCredMap = new Map<string, boolean>();
    for (const slug of globalSlugs) {
      const globalCreds = await db
        .select({ pk: integrationCredentials.pk })
        .from(integrationCredentials)
        .where(eq(integrationCredentials.integrationId, `global:${slug}`))
        .limit(1);
      globalCredMap.set(slug, globalCreds.length > 0);
    }

    const integrations = await Promise.all(
      toolkits.map(async (toolkit) => {
        const userRow = userMap.get(toolkit.slug);

        let status: string;
        let credentialHints: Record<string, string> | undefined;

        if (toolkit.authScheme === "api_key_global") {
          status = globalCredMap.get(toolkit.slug) ? "active" : "pending";
        } else if (userRow) {
          status = userRow.status ?? "pending";
          if (
            toolkit.authScheme === "api_key_user" &&
            status === "active" &&
            userRow.id
          ) {
            credentialHints = await getCredentialHints(userRow.id);
          }
        } else {
          status = "pending";
        }

        return {
          id: userRow?.id,
          toolkit: buildToolkitInfo(toolkit),
          status: status as
            | "pending"
            | "initiated"
            | "active"
            | "failed"
            | "expired"
            | "disconnected",
          connectedAt: userRow?.connectedAt ?? undefined,
          credentialHints,
        };
      }),
    );

    return c.json({ integrations }, 200);
  });

  // POST /api/v1/integrations/connect
  app.openapi(connectIntegrationRoute, async (c) => {
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const { toolkitSlug, credentials, source, returnTo } = body;

    const [toolkit] = await db
      .select()
      .from(supportedToolkits)
      .where(
        and(
          eq(supportedToolkits.slug, toolkitSlug),
          eq(supportedToolkits.enabled, true),
        ),
      )
      .limit(1);

    if (!toolkit) {
      return c.json({ message: "Toolkit not found" }, 404);
    }

    if (toolkit.authScheme === "api_key_global") {
      return c.json(
        { message: "Global toolkits are managed by the administrator" },
        400,
      );
    }

    const authFields = parseAuthFields(toolkit.authFields);
    const now = new Date().toISOString();

    const [existing] = await db
      .select()
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.userId, userId),
          eq(userIntegrations.toolkitSlug, toolkitSlug),
        ),
      )
      .limit(1);

    // Handle api_key_user — validate BEFORE upserting
    if (toolkit.authScheme === "api_key_user") {
      if (!credentials) {
        return c.json(
          { message: "Credentials required for this toolkit" },
          400,
        );
      }
      validateCredentialFields(authFields, credentials);

      let integrationId: string;
      if (existing) {
        integrationId = existing.id;
        await db
          .update(userIntegrations)
          .set({
            status: "active",
            oauthState: null,
            composioAccountId: null,
            returnTo: returnTo ?? null,
            source: source ?? null,
            connectedAt: now,
            updatedAt: now,
          })
          .where(eq(userIntegrations.id, existing.id));
      } else {
        integrationId = createId();
        await db.insert(userIntegrations).values({
          id: integrationId,
          userId,
          toolkitSlug,
          status: "active",
          connectedAt: now,
          returnTo: returnTo ?? null,
          source: source ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }

      await db
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.integrationId, integrationId));

      for (const field of authFields) {
        const value = credentials[field.key] ?? "";
        const encrypted = encrypt(value);
        await db.insert(integrationCredentials).values({
          id: createId(),
          integrationId,
          credentialKey: field.key,
          encryptedValue: encrypted,
          createdAt: now,
        });
      }

      const hints = await getCredentialHints(integrationId);

      return c.json(
        {
          integration: {
            id: integrationId,
            toolkit: buildToolkitInfo(toolkit),
            status: "active" as const,
            connectedAt: now,
            credentialHints: hints,
          },
        },
        200,
      );
    }

    // Handle oauth2 — validate API key BEFORE upserting
    const composioContext = await resolveComposioUserContext(userId);
    if (!composioContext.ok) {
      return c.json(
        { message: composioContext.message },
        composioContext.status,
      );
    }

    const oauthState = crypto.randomUUID();
    let integrationId: string;

    if (existing) {
      integrationId = existing.id;
      await db
        .update(userIntegrations)
        .set({
          status: "initiated",
          oauthState,
          composioAccountId: null,
          returnTo: returnTo ?? null,
          source: source ?? null,
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
        returnTo: returnTo ?? null,
        source: source ?? null,
        createdAt: now,
        updatedAt: now,
      });
    }

    const result = await initializeOAuthConnection(
      composioContext.apiKey,
      toolkitSlug,
      userId,
      oauthState,
      integrationId,
    );

    return c.json(
      {
        integration: {
          id: integrationId,
          toolkit: buildToolkitInfo(toolkit),
          status: "initiated" as const,
        },
        connectUrl: result.redirectUrl,
        state: oauthState,
      },
      200,
    );
  });

  // POST /api/v1/integrations/{integrationId}/refresh
  app.openapi(refreshIntegrationRoute, async (c) => {
    const userId = c.get("userId");
    const { integrationId } = c.req.valid("param");
    const body = c.req.valid("json");
    const state = body.state;

    const [integration] = await db
      .select()
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.id, integrationId),
          eq(userIntegrations.userId, userId),
        ),
      )
      .limit(1);

    if (!integration) {
      return c.json({ message: "Integration not found" }, 404);
    }

    const [toolkit] = await db
      .select()
      .from(supportedToolkits)
      .where(eq(supportedToolkits.slug, integration.toolkitSlug))
      .limit(1);

    const toolkitInfo = toolkit
      ? buildToolkitInfo(toolkit)
      : buildFallbackToolkitInfo(integration.toolkitSlug);

    // If already active, return success idempotently (handles race between tabs)
    if (integration.status === "active") {
      return c.json(
        {
          id: integrationId,
          toolkit: toolkitInfo,
          status: "active" as const,
          connectedAt: integration.connectedAt ?? undefined,
          returnTo: integration.returnTo ?? undefined,
          source: (integration.source as "page" | "chat") ?? undefined,
        },
        200,
      );
    }

    if (toolkit && toolkit.authScheme !== "oauth2") {
      return c.json(
        { message: "Refresh is only available for OAuth2 integrations" },
        400,
      );
    }

    // CSRF state verification (skip if no state provided — callback page without localStorage)
    if (state) {
      if (!integration.oauthState || integration.oauthState !== state) {
        return c.json({ message: "Invalid or expired state token" }, 403);
      }
    }

    const composioContext = await resolveComposioUserContext(userId);
    if (!composioContext.ok) {
      return c.json(
        { message: composioContext.message },
        composioContext.status,
      );
    }

    const composioStatus = await checkOAuthStatus(
      composioContext.apiKey,
      userId,
      integration.toolkitSlug,
    );
    const now = new Date().toISOString();

    if (composioStatus.status === "ACTIVE") {
      await db
        .update(userIntegrations)
        .set({
          status: "active",
          composioAccountId: composioStatus.connectedAccountId ?? null,
          connectedAt: now,
          oauthState: null,
          updatedAt: now,
        })
        .where(eq(userIntegrations.id, integrationId));

      return c.json(
        {
          id: integrationId,
          toolkit: toolkitInfo,
          status: "active" as const,
          connectedAt: now,
          returnTo: integration.returnTo ?? undefined,
          source: (integration.source as "page" | "chat") ?? undefined,
        },
        200,
      );
    }

    return c.json(
      {
        id: integrationId,
        toolkit: toolkitInfo,
        status: "initiated" as const,
      },
      200,
    );
  });

  // DELETE /api/v1/integrations/{integrationId}
  app.openapi(deleteIntegrationRoute, async (c) => {
    const userId = c.get("userId");
    const { integrationId } = c.req.valid("param");

    const [integration] = await db
      .select()
      .from(userIntegrations)
      .where(
        and(
          eq(userIntegrations.id, integrationId),
          eq(userIntegrations.userId, userId),
        ),
      )
      .limit(1);

    if (!integration) {
      return c.json({ message: "Integration not found" }, 404);
    }

    const [toolkit] = await db
      .select()
      .from(supportedToolkits)
      .where(eq(supportedToolkits.slug, integration.toolkitSlug))
      .limit(1);

    if (toolkit?.authScheme === "api_key_global") {
      return c.json(
        { message: "Cannot disconnect admin-managed integrations" },
        403,
      );
    }

    const now = new Date().toISOString();

    if (toolkit?.authScheme === "oauth2" && integration.composioAccountId) {
      await revokeConnection(integration.composioAccountId);
    }

    if (toolkit?.authScheme === "api_key_user") {
      await db
        .delete(integrationCredentials)
        .where(eq(integrationCredentials.integrationId, integrationId));
    }

    await db
      .update(userIntegrations)
      .set({
        status: "disconnected",
        disconnectedAt: now,
        composioAccountId: null,
        oauthState: null,
        updatedAt: now,
      })
      .where(eq(userIntegrations.id, integrationId));

    const toolkitInfo = toolkit
      ? buildToolkitInfo(toolkit)
      : buildFallbackToolkitInfo(integration.toolkitSlug);

    return c.json(
      {
        id: integrationId,
        toolkit: toolkitInfo,
        status: "disconnected" as const,
        disconnectedAt: now,
      },
      200,
    );
  });
}
