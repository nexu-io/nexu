import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { and, eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { poolSecrets } from "../db/schema/index.js";
import { decrypt } from "../lib/crypto.js";
import { requireSkillToken } from "../middleware/internal-auth.js";
import type { AppBindings } from "../types.js";

const skillNameParam = z.object({
  skillName: z.string().min(1).max(64),
});

const poolIdQuery = z.object({
  poolId: z.string().min(1),
});

const getSecretsRoute = createRoute({
  method: "get",
  path: "/api/internal/secrets/{skillName}",
  tags: ["Secrets (Internal)"],
  request: {
    params: skillNameParam,
    query: poolIdQuery,
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: z.record(z.string()) },
      },
      description: "Scoped secrets for skill",
    },
    401: {
      content: {
        "application/json": { schema: z.object({ message: z.string() }) },
      },
      description: "Unauthorized",
    },
  },
});

export function registerSecretRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getSecretsRoute, async (c) => {
    requireSkillToken(c);
    const { skillName } = c.req.valid("param");
    const { poolId } = c.req.valid("query");

    const rows = await db
      .select({
        secretName: poolSecrets.secretName,
        encryptedValue: poolSecrets.encryptedValue,
        scope: poolSecrets.scope,
      })
      .from(poolSecrets)
      .where(
        and(
          eq(poolSecrets.poolId, poolId),
          or(
            eq(poolSecrets.scope, "pool"),
            eq(poolSecrets.scope, `skill:${skillName}`),
          ),
        ),
      );

    const secrets: Record<string, string> = {};
    for (const row of rows) {
      try {
        secrets[row.secretName] = decrypt(row.encryptedValue);
      } catch {
        // Skip secrets that fail to decrypt
      }
    }

    return c.json(secrets, 200);
  });
}
