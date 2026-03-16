import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  openclawModelSettingsResponseSchema,
  updateOpenclawModelSettingsResponseSchema,
  updateOpenclawModelSettingsSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { poolSecrets } from "../db/schema/index.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import {
  getOpenclawModelSettingsSecretName,
  mergeOpenclawModelSettings,
  parseStoredOpenclawModelSettings,
  stringifyStoredOpenclawModelSettings,
  toOpenclawModelSettingsResponse,
} from "../lib/openclaw-model-settings.js";
import { resolvePrimaryUserPoolId } from "../lib/user-pool.js";
import { publishPoolConfigSnapshot } from "../services/runtime/pool-config-service.js";
import type { AppBindings } from "../types.js";

const errorResponseSchema = z.object({
  message: z.string(),
});

const getOpenclawModelSettingsRoute = createRoute({
  method: "get",
  path: "/api/v1/openclaw/model-settings",
  tags: ["OpenClaw Settings"],
  responses: {
    200: {
      content: {
        "application/json": {
          schema: openclawModelSettingsResponseSchema,
        },
      },
      description:
        "Current OpenClaw model provider settings for the user's pool",
    },
  },
});

const putOpenclawModelSettingsRoute = createRoute({
  method: "put",
  path: "/api/v1/openclaw/model-settings",
  tags: ["OpenClaw Settings"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: updateOpenclawModelSettingsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: updateOpenclawModelSettingsResponseSchema,
        },
      },
      description: "OpenClaw model provider settings saved and published",
    },
    400: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Invalid request",
    },
  },
});

async function getStoredSettings(poolId: string) {
  const [row] = await db
    .select({ encryptedValue: poolSecrets.encryptedValue })
    .from(poolSecrets)
    .where(
      and(
        eq(poolSecrets.poolId, poolId),
        eq(poolSecrets.secretName, getOpenclawModelSettingsSecretName()),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  try {
    return parseStoredOpenclawModelSettings(decrypt(row.encryptedValue));
  } catch {
    return null;
  }
}

export function registerOpenclawModelSettingsRoutes(
  app: OpenAPIHono<AppBindings>,
) {
  app.openapi(getOpenclawModelSettingsRoute, async (c) => {
    const userId = c.get("userId");
    const poolId = await resolvePrimaryUserPoolId(db, userId);
    const stored = await getStoredSettings(poolId);
    return c.json(toOpenclawModelSettingsResponse(poolId, stored), 200);
  });

  app.openapi(putOpenclawModelSettingsRoute, async (c) => {
    const userId = c.get("userId");
    const input = c.req.valid("json");
    const poolId = await resolvePrimaryUserPoolId(db, userId);
    const now = new Date().toISOString();
    const previous = await getStoredSettings(poolId);
    const stored = mergeOpenclawModelSettings(previous, input, now);
    const encryptedValue = encrypt(
      stringifyStoredOpenclawModelSettings(stored),
    );

    await db
      .insert(poolSecrets)
      .values({
        id: createId(),
        poolId,
        secretName: getOpenclawModelSettingsSecretName(),
        encryptedValue,
        scope: "pool",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [poolSecrets.poolId, poolSecrets.secretName],
        set: {
          encryptedValue,
          updatedAt: now,
        },
      });

    const snapshot = await publishPoolConfigSnapshot(db, poolId);
    return c.json(
      {
        ok: true,
        poolId,
        updatedAt: now,
        publishedVersion: snapshot.version,
      },
      200,
    );
  });
}
