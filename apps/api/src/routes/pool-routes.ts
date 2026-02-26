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
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { gatewayPools } from "../db/schema/index.js";
import { generatePoolConfig } from "../lib/config-generator.js";
import { requireInternalToken } from "../middleware/internal-auth.js";
import {
  getLatestPoolConfigSnapshot,
  getPoolConfigSnapshotByVersion,
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

export function registerPoolRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getPoolConfigRoute, async (c) => {
    requireInternalToken(c);
    const { poolId } = c.req.valid("param");

    try {
      const config = await generatePoolConfig(db, poolId);
      return c.json(config, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (message.includes("not found")) {
        return c.json({ message }, 404);
      }
      throw error;
    }
  });

  app.openapi(poolRegisterRoute, async (c) => {
    requireInternalToken(c);
    const input = c.req.valid("json");
    const now = new Date().toISOString();

    const [existingPool] = await db
      .select({ id: gatewayPools.id })
      .from(gatewayPools)
      .where(eq(gatewayPools.id, input.poolId))
      .limit(1);

    if (existingPool) {
      await db
        .update(gatewayPools)
        .set({
          status: input.status,
          podIp: input.podIp,
          lastHeartbeat: now,
        })
        .where(eq(gatewayPools.id, input.poolId));
    } else {
      await db.insert(gatewayPools).values({
        id: input.poolId,
        poolName: input.poolId,
        poolType: "shared",
        status: input.status,
        podIp: input.podIp,
        lastHeartbeat: now,
        createdAt: now,
      });
    }

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

    const snapshot = await getLatestPoolConfigSnapshot(db, poolId);
    return c.json(
      {
        poolId: snapshot.poolId,
        version: snapshot.version,
        configHash: snapshot.configHash,
        config: snapshot.config,
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

    return c.json(
      {
        poolId: snapshot.poolId,
        version: snapshot.version,
        configHash: snapshot.configHash,
        config: snapshot.config,
        createdAt: snapshot.createdAt,
      },
      200,
    );
  });
}
