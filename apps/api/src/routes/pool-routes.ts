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
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { bots, gatewayPools, poolSecrets } from "../db/schema/index.js";
import { generatePoolConfig } from "../lib/config-generator.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { BaseError, ServiceError } from "../lib/error.js";
import { requireInternalToken } from "../middleware/internal-auth.js";
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

async function buildAgentMeta(
  poolId: string,
): Promise<Record<string, { botId: string }>> {
  const poolBots = await db
    .select({ id: bots.id, slug: bots.slug, status: bots.status })
    .from(bots)
    .where(and(eq(bots.poolId, poolId), eq(bots.status, "active")));

  const agentMeta: Record<string, { botId: string }> = {};
  for (const bot of poolBots) {
    agentMeta[bot.slug] = { botId: bot.id };
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
            secrets: z.record(z.string()),
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
    for (const [name, value] of Object.entries(secrets)) {
      const encryptedValue = encrypt(value);
      await db
        .insert(poolSecrets)
        .values({
          id: createId(),
          poolId,
          secretName: name,
          encryptedValue,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [poolSecrets.poolId, poolSecrets.secretName],
          set: { encryptedValue, updatedAt: now },
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
}
