import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema/index.js";
import type { AppBindings } from "../types.js";

/**
 * Middleware that authenticates requests via Bearer API key.
 * Looks up candidate rows by key prefix, then verifies with bcrypt compare.
 */
export const apiKeyMiddleware = createMiddleware<AppBindings>(
  async (c, next) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "API key required" }, 401);
    }

    const token = authHeader.slice(7);
    const keyPrefix = token.slice(0, 12);

    // Find candidate rows by prefix
    const candidates = await db
      .select({
        pk: apiKeys.pk,
        userId: apiKeys.userId,
        status: apiKeys.status,
        keyHash: apiKeys.keyHash,
      })
      .from(apiKeys)
      .where(eq(apiKeys.keyPrefix, keyPrefix));

    // Verify with bcrypt
    const matched = candidates.find(
      (row) =>
        row.status === "active" && bcrypt.compareSync(token, row.keyHash),
    );

    if (!matched) {
      return c.json({ error: "Invalid or revoked API key" }, 401);
    }

    // Update last used timestamp (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiKeys.pk, matched.pk))
      .catch(() => {});

    c.set("userId", matched.userId);
    await next();
  },
);
