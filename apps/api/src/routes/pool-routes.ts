import { createHash } from "node:crypto";
import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  openclawConfigSchema,
  runtimePoolConfigResponseSchema,
  runtimePoolHeartbeatResponseSchema,
  runtimePoolHeartbeatSchema,
  runtimePoolRegisterResponseSchema,
  runtimePoolRegisterSchema,
  slackTokenHealthCheckResponseSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  botChannels,
  bots,
  channelCredentials,
  gatewayPools,
  poolSecrets,
} from "../db/schema/index.js";
import { generatePoolConfig } from "../lib/config-generator.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { BaseError, ServiceError } from "../lib/error.js";
import { logger } from "../lib/logger.js";
import {
  requireInternalToken,
  requireSkillToken,
} from "../middleware/internal-auth.js";
import {
  getPoolConfigSnapshotByVersion,
  publishPoolConfigSnapshot,
} from "../services/runtime/pool-config-service.js";
import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const poolIdParam = z.object({
  poolId: z.string(),
});

const poolConfigVersionParam = z.object({
  poolId: z.string(),
  version: z.coerce.number().int().nonnegative(),
});

const staticDeploySecretsQuery = z.object({
  poolId: z.string(),
});

const staticDeploySecretsResponseSchema = z.object({
  CLOUDFLARE_API_TOKEN: z.string(),
  CLOUDFLARE_ACCOUNT_ID: z.string(),
});

const getPoolConfigRoute = createRoute({
  method: "get",
  path: "/api/internal/pools/{poolId}/config",
  tags: ["Internal"],
  request: {
    params: poolIdParam,
  },
  responses: {
    200: {
      content: { "application/json": { schema: openclawConfigSchema } },
      description: "Generated OpenClaw config",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Pool not found",
    },
  },
});

const poolRegisterRoute = createRoute({
  method: "post",
  path: "/api/internal/pools/register",
  tags: ["Internal"],
  request: {
    body: {
      content: { "application/json": { schema: runtimePoolRegisterSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: runtimePoolRegisterResponseSchema },
      },
      description: "Pool node registered",
    },
  },
});

const poolHeartbeatRoute = createRoute({
  method: "post",
  path: "/api/internal/pools/heartbeat",
  tags: ["Internal"],
  request: {
    body: {
      content: { "application/json": { schema: runtimePoolHeartbeatSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: runtimePoolHeartbeatResponseSchema },
      },
      description: "Pool node heartbeat accepted",
    },
  },
});

const getPoolConfigLatestRoute = createRoute({
  method: "get",
  path: "/api/internal/pools/{poolId}/config/latest",
  tags: ["Internal"],
  request: {
    params: poolIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: runtimePoolConfigResponseSchema },
      },
      description: "Latest pool config snapshot",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Pool not found",
    },
  },
});

const getPoolConfigByVersionRoute = createRoute({
  method: "get",
  path: "/api/internal/pools/{poolId}/config/versions/{version}",
  tags: ["Internal"],
  request: {
    params: poolConfigVersionParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: runtimePoolConfigResponseSchema },
      },
      description: "Pool config snapshot by version",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Config version not found",
    },
  },
});

const getStaticDeploySecretsRoute = createRoute({
  method: "get",
  path: "/api/internal/secrets/static-deploy",
  tags: ["Internal"],
  request: {
    query: staticDeploySecretsQuery,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: staticDeploySecretsResponseSchema },
      },
      description: "Static deploy secrets for a pool",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Pool not found",
    },
  },
});

const checkSlackTokensRoute = createRoute({
  method: "post",
  path: "/api/internal/pools/{poolId}/check-slack-tokens",
  tags: ["Internal"],
  request: {
    params: poolIdParam,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: slackTokenHealthCheckResponseSchema },
      },
      description: "Slack token health check results",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Pool not found",
    },
  },
});

async function checkSlackTokenHealth(poolId: string): Promise<{
  checked: number;
  invalidated: number;
  results: {
    botChannelId: string;
    accountId: string;
    ok: boolean;
    error?: string;
  }[];
}> {
  const poolBots = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.poolId, poolId), eq(bots.status, "active")));

  const botIds = poolBots.map((b) => b.id);
  if (botIds.length === 0) {
    return { checked: 0, invalidated: 0, results: [] };
  }

  // Collect all connected Slack channels across all bots in this pool
  const slackChannels: {
    channelId: string;
    accountId: string;
    botId: string;
  }[] = [];
  for (const botId of botIds) {
    const channels = await db
      .select({ id: botChannels.id, accountId: botChannels.accountId })
      .from(botChannels)
      .where(
        and(
          eq(botChannels.botId, botId),
          eq(botChannels.channelType, "slack"),
          eq(botChannels.status, "connected"),
        ),
      );
    for (const ch of channels) {
      slackChannels.push({
        channelId: ch.id,
        accountId: ch.accountId,
        botId,
      });
    }
  }

  if (slackChannels.length === 0) {
    return { checked: 0, invalidated: 0, results: [] };
  }

  // Fetch bot tokens for all channels
  const channelTokens: {
    channelId: string;
    accountId: string;
    token: string;
  }[] = [];
  for (const ch of slackChannels) {
    const [tokenRow] = await db
      .select({ encryptedValue: channelCredentials.encryptedValue })
      .from(channelCredentials)
      .where(
        and(
          eq(channelCredentials.botChannelId, ch.channelId),
          eq(channelCredentials.credentialType, "botToken"),
        ),
      );
    if (tokenRow) {
      try {
        channelTokens.push({
          channelId: ch.channelId,
          accountId: ch.accountId,
          token: decrypt(tokenRow.encryptedValue),
        });
      } catch {
        // Decryption failed — treat as invalid
        channelTokens.push({
          channelId: ch.channelId,
          accountId: ch.accountId,
          token: "",
        });
      }
    }
  }

  // Validate all tokens concurrently
  const checkResults = await Promise.allSettled(
    channelTokens.map(async (ct) => {
      if (!ct.token) {
        return { ...ct, ok: false, error: "decrypt_failed" };
      }
      const resp = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ct.token}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        signal: AbortSignal.timeout(5000),
      });
      const data = (await resp.json()) as { ok: boolean; error?: string };
      return { ...ct, ok: data.ok, error: data.error };
    }),
  );

  const results: {
    botChannelId: string;
    accountId: string;
    ok: boolean;
    error?: string;
  }[] = [];
  const invalidChannelIds: string[] = [];

  for (const result of checkResults) {
    if (result.status === "fulfilled") {
      const r = result.value;
      results.push({
        botChannelId: r.channelId,
        accountId: r.accountId,
        ok: r.ok,
        error: r.error,
      });
      if (!r.ok) {
        invalidChannelIds.push(r.channelId);
      }
    } else {
      // Promise rejected (timeout, network error)
      // Don't mark as invalid on transient errors — skip
      logger.warn({
        message: "slack_token_check_request_failed",
        error: String(result.reason),
      });
    }
  }

  // Mark invalid channels
  if (invalidChannelIds.length > 0) {
    const now = new Date().toISOString();
    for (const channelId of invalidChannelIds) {
      await db
        .update(botChannels)
        .set({ status: "error", updatedAt: now })
        .where(eq(botChannels.id, channelId));
    }

    logger.info({
      message: "slack_token_health_check_invalidated",
      pool_id: poolId,
      invalidated_count: invalidChannelIds.length,
      invalidated_ids: invalidChannelIds,
    });

    // Trigger config regeneration to exclude dead accounts
    await publishPoolConfigSnapshot(db, poolId);
  }

  return {
    checked: results.length,
    invalidated: invalidChannelIds.length,
    results,
  };
}

async function buildAgentMeta(
  poolId: string,
): Promise<Record<string, { botId: string }>> {
  const poolBots = await db
    .select({ id: bots.id, slug: bots.slug, status: bots.status })
    .from(bots)
    .where(and(eq(bots.poolId, poolId), eq(bots.status, "active")));

  const agentMeta: Record<string, { botId: string }> = {};
  for (const bot of poolBots) {
    agentMeta[bot.id] = { botId: bot.id };
  }
  return agentMeta;
}

async function buildPoolSecrets(
  poolId: string,
): Promise<{ secrets: Record<string, string>; secretsHash: string }> {
  const rows = await db
    .select({
      secretName: poolSecrets.secretName,
      encryptedValue: poolSecrets.encryptedValue,
    })
    .from(poolSecrets)
    .where(eq(poolSecrets.poolId, poolId))
    .orderBy(poolSecrets.secretName);

  const secrets: Record<string, string> = {};
  for (const row of rows) {
    try {
      secrets[row.secretName] = decrypt(row.encryptedValue);
    } catch {
      // Skip secrets that fail to decrypt
    }
  }

  const hashInput = rows
    .map((r) => `${r.secretName}:${r.encryptedValue}`)
    .join("\n");
  const secretsHash = createHash("sha256").update(hashInput).digest("hex");
  return { secrets, secretsHash };
}

const putPoolSecretsRoute = createRoute({
  method: "put",
  path: "/api/internal/pools/{poolId}/secrets",
  tags: ["Internal"],
  request: {
    params: poolIdParam,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            secrets: z.record(
              z.union([
                z.string(),
                z.object({
                  value: z.string(),
                  scope: z.string().default("pool"),
                }),
              ]),
            ),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ ok: z.boolean(), count: z.number() }),
        },
      },
      description: "Secrets stored",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "Pool not found",
    },
  },
});

export function registerPoolRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getPoolConfigRoute, async (c) => {
    requireInternalToken(c);
    const { poolId } = c.req.valid("param");

    try {
      const config = await generatePoolConfig(db, poolId);
      return c.json(config, 200);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        error.context.code === "pool_not_found"
      ) {
        return c.json({ message: `Pool ${poolId} not found` }, 404);
      }

      const baseError = BaseError.from(error);
      throw ServiceError.from(
        "pool-routes",
        {
          code: "pool_get_config_failed",
          pool_id: poolId,
          message: baseError.message,
        },
        { cause: baseError },
      );
    }
  });

  app.openapi(poolRegisterRoute, async (c) => {
    requireInternalToken(c);
    const input = c.req.valid("json");
    const now = new Date().toISOString();

    await db
      .insert(gatewayPools)
      .values({
        id: input.poolId,
        poolName: input.poolId,
        poolType: "shared",
        status: input.status,
        podIp: input.podIp,
        lastHeartbeat: now,
        createdAt: now,
      })
      .onConflictDoUpdate({
        target: gatewayPools.id,
        set: {
          status: input.status,
          podIp: input.podIp,
          lastHeartbeat: now,
        },
      });

    return c.json({ ok: true, poolId: input.poolId }, 200);
  });

  app.openapi(poolHeartbeatRoute, async (c) => {
    requireInternalToken(c);
    const input = c.req.valid("json");
    const now = input.timestamp ?? new Date().toISOString();

    await db
      .update(gatewayPools)
      .set({
        status: input.status,
        podIp: input.podIp,
        lastHeartbeat: now,
        ...(input.lastSeenVersion !== undefined
          ? { lastSeenVersion: input.lastSeenVersion }
          : {}),
      })
      .where(eq(gatewayPools.id, input.poolId));

    return c.json(
      { ok: true, poolId: input.poolId, status: input.status },
      200,
    );
  });

  app.openapi(putPoolSecretsRoute, async (c) => {
    requireInternalToken(c);
    const { poolId } = c.req.valid("param");
    const { secrets } = c.req.valid("json");

    const [pool] = await db
      .select({ id: gatewayPools.id })
      .from(gatewayPools)
      .where(eq(gatewayPools.id, poolId))
      .limit(1);

    if (!pool) {
      return c.json({ message: `Pool ${poolId} not found` }, 404);
    }

    const now = new Date().toISOString();
    let count = 0;
    for (const [name, entry] of Object.entries(secrets)) {
      const value = typeof entry === "string" ? entry : entry.value;
      const scope = typeof entry === "string" ? "pool" : entry.scope;
      const encryptedValue = encrypt(value);
      await db
        .insert(poolSecrets)
        .values({
          id: createId(),
          poolId,
          secretName: name,
          encryptedValue,
          scope,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [poolSecrets.poolId, poolSecrets.secretName],
          set: { encryptedValue, scope, updatedAt: now },
        });
      count++;
    }

    return c.json({ ok: true, count }, 200);
  });

  app.openapi(getPoolConfigLatestRoute, async (c) => {
    requireInternalToken(c);
    const { poolId } = c.req.valid("param");

    const [pool] = await db
      .select({ id: gatewayPools.id })
      .from(gatewayPools)
      .where(eq(gatewayPools.id, poolId))
      .limit(1);

    if (!pool) {
      return c.json({ message: `Pool ${poolId} not found` }, 404);
    }

    const snapshot = await publishPoolConfigSnapshot(db, poolId);
    const agentMeta = await buildAgentMeta(poolId);
    const { secrets, secretsHash } = await buildPoolSecrets(poolId);
    return c.json(
      {
        poolId: snapshot.poolId,
        version: snapshot.version,
        configHash: snapshot.configHash,
        config: snapshot.config,
        agentMeta,
        poolSecrets: secrets,
        secretsHash,
        createdAt: snapshot.createdAt,
      },
      200,
    );
  });

  app.openapi(getPoolConfigByVersionRoute, async (c) => {
    requireInternalToken(c);
    const { poolId, version } = c.req.valid("param");

    const snapshot = await getPoolConfigSnapshotByVersion(db, poolId, version);
    if (!snapshot) {
      return c.json(
        { message: `Pool ${poolId} config version ${version} not found` },
        404,
      );
    }

    const agentMeta = await buildAgentMeta(poolId);
    const { secrets, secretsHash } = await buildPoolSecrets(poolId);
    return c.json(
      {
        poolId: snapshot.poolId,
        version: snapshot.version,
        configHash: snapshot.configHash,
        config: snapshot.config,
        agentMeta,
        poolSecrets: secrets,
        secretsHash,
        createdAt: snapshot.createdAt,
      },
      200,
    );
  });

  app.openapi(getStaticDeploySecretsRoute, async (c) => {
    requireSkillToken(c);
    const { poolId } = c.req.valid("query");

    const [pool] = await db
      .select({ id: gatewayPools.id })
      .from(gatewayPools)
      .where(eq(gatewayPools.id, poolId))
      .limit(1);

    if (!pool) {
      return c.json({ message: `Pool ${poolId} not found` }, 404);
    }

    const { secrets } = await buildPoolSecrets(poolId);
    const cloudflareApiToken = secrets.CLOUDFLARE_API_TOKEN;
    const cloudflareAccountId = secrets.CLOUDFLARE_ACCOUNT_ID;

    if (!cloudflareApiToken || !cloudflareAccountId) {
      return c.json(
        { message: `Missing Cloudflare secrets for pool ${poolId}` },
        404,
      );
    }

    return c.json(
      {
        CLOUDFLARE_API_TOKEN: cloudflareApiToken,
        CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
      },
      200,
    );
  });

  app.openapi(checkSlackTokensRoute, async (c) => {
    requireInternalToken(c);
    const { poolId } = c.req.valid("param");

    const [pool] = await db
      .select({ id: gatewayPools.id })
      .from(gatewayPools)
      .where(eq(gatewayPools.id, poolId))
      .limit(1);

    if (!pool) {
      return c.json({ message: `Pool ${poolId} not found` }, 404);
    }

    const result = await checkSlackTokenHealth(poolId);
    return c.json(result, 200);
  });
}
