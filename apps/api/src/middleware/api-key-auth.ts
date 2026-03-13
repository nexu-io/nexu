import { createHash } from "node:crypto";
import { createMiddleware } from "hono/factory";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys } from "../db/schema/index.js";
import type { AppBindings } from "../types.js";

/**
 * Middleware that authenticates requests via Bearer API key.
 * Looks up the key hash in the api_keys table and sets userId in context.
 */
export const apiKeyMiddleware = createMiddleware<AppBindings>(
  async (c, next) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "API key required" }, 401);
    }

    const token = authHeader.slice(7);
    const keyHash = createHash("sha256").update(token).digest("hex");

    const [row] = await db
      .select({ userId: apiKeys.userId, status: apiKeys.status })
      .from(apiKeys)
      .where(eq(apiKeys.keyHash, keyHash));

    if (!row || row.status !== "active") {
      return c.json({ error: "Invalid or revoked API key" }, 401);
    }

    // Update last used timestamp (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsedAt: new Date().toISOString() })
      .where(eq(apiKeys.keyHash, keyHash))
      .catch(() => {});

    c.set("userId", row.userId);
    await next();
  },
);
