import { createHash, randomBytes } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { eq, and, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  apiKeys,
  desktopDeviceAuthorizations,
  users,
} from "../db/schema/index.js";
import { encrypt, decrypt } from "../lib/crypto.js";
import type { AppBindings } from "../types.js";

/**
 * Public endpoints for the desktop device authorization flow.
 * Registered BEFORE authMiddleware — no session required.
 */
export function registerDesktopDeviceRoutes(app: OpenAPIHono<AppBindings>) {
  // Step 1: Desktop client registers a device before opening the browser.
  app.post("/api/auth/desktop-device-register", async (c) => {
    const body = await c.req.json<{
      deviceId?: string;
      deviceSecretHash?: string;
    }>();

    if (!body.deviceId || !body.deviceSecretHash) {
      return c.json({ error: "deviceId and deviceSecretHash are required" }, 400);
    }

    // Clean up expired rows opportunistically
    await db
      .delete(desktopDeviceAuthorizations)
      .where(lt(desktopDeviceAuthorizations.expiresAt, new Date().toISOString()));

    await db.insert(desktopDeviceAuthorizations).values({
      id: createId(),
      deviceId: body.deviceId,
      deviceSecretHash: body.deviceSecretHash,
      status: "pending",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    return c.json({ ok: true });
  });

  // Step 3: Desktop client polls for authorization result.
  app.post("/api/auth/desktop-poll", async (c) => {
    const body = await c.req.json<{
      deviceId?: string;
      deviceSecret?: string;
    }>();

    if (!body.deviceId || !body.deviceSecret) {
      return c.json({ error: "deviceId and deviceSecret are required" }, 400);
    }

    const [row] = await db
      .select()
      .from(desktopDeviceAuthorizations)
      .where(eq(desktopDeviceAuthorizations.deviceId, body.deviceId));

    if (!row) {
      return c.json({ status: "expired" });
    }

    // Verify deviceSecret
    const secretHash = createHash("sha256")
      .update(body.deviceSecret)
      .digest("hex");
    if (secretHash !== row.deviceSecretHash) {
      return c.json({ error: "invalid device secret" }, 403);
    }

    // Check expiry
    if (new Date(row.expiresAt) < new Date()) {
      await db
        .delete(desktopDeviceAuthorizations)
        .where(eq(desktopDeviceAuthorizations.pk, row.pk));
      return c.json({ status: "expired" });
    }

    if (row.status === "pending") {
      return c.json({ status: "pending" });
    }

    if (row.status === "completed" && row.encryptedApiKey && row.userId) {
      // Decrypt the API key
      const apiKey = decrypt(row.encryptedApiKey);

      // Look up user details
      const [user] = await db
        .select({ id: users.id, authUserId: users.authUserId })
        .from(users)
        .where(eq(users.authUserId, row.userId));

      // Look up auth user for name/email
      let userName = "";
      let userEmail = "";
      if (user) {
        const { pool } = await import("../db/index.js");
        const authResult = await pool.query(
          `SELECT name, email FROM "user" WHERE id = $1 LIMIT 1`,
          [row.userId],
        );
        if (authResult.rows[0]) {
          userName = authResult.rows[0].name ?? "";
          userEmail = authResult.rows[0].email ?? "";
        }
      }

      // Delete the row — one-time retrieval
      await db
        .delete(desktopDeviceAuthorizations)
        .where(eq(desktopDeviceAuthorizations.pk, row.pk));

      return c.json({
        status: "completed",
        apiKey,
        userId: user?.id ?? row.userId,
        userName,
        userEmail,
      });
    }

    return c.json({ status: "pending" });
  });
}

/**
 * Session-protected endpoint for authorizing a desktop device.
 * Registered AFTER authMiddleware.
 */
export function registerDesktopAuthorizeRoute(app: OpenAPIHono<AppBindings>) {
  // Step 2: After browser login, frontend calls this to bind the device.
  app.post("/api/v1/auth/desktop-authorize", async (c) => {
    const authUserId = c.get("userId");
    const body = await c.req.json<{ deviceId?: string }>();

    if (!body.deviceId) {
      return c.json({ error: "deviceId is required" }, 400);
    }

    // Find the pending device authorization
    const [row] = await db
      .select()
      .from(desktopDeviceAuthorizations)
      .where(
        and(
          eq(desktopDeviceAuthorizations.deviceId, body.deviceId),
          eq(desktopDeviceAuthorizations.status, "pending"),
        ),
      );

    if (!row) {
      return c.json({ error: "device not found or already authorized" }, 404);
    }

    if (new Date(row.expiresAt) < new Date()) {
      await db
        .delete(desktopDeviceAuthorizations)
        .where(eq(desktopDeviceAuthorizations.pk, row.pk));
      return c.json({ error: "device authorization expired" }, 410);
    }

    // Look up app user
    const [appUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authUserId, authUserId));

    if (!appUser) {
      return c.json({ error: "user not found" }, 404);
    }

    // Generate API key
    const rawKey = `nxk_${randomBytes(32).toString("base64url")}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = createHash("sha256").update(rawKey).digest("hex");

    // Insert into api_keys
    await db.insert(apiKeys).values({
      id: createId(),
      userId: appUser.id,
      name: "Nexu Desktop",
      keyPrefix,
      keyHash,
      status: "active",
    });

    // Encrypt the plaintext key and store it for the poll response
    const encryptedApiKey = encrypt(rawKey);

    await db
      .update(desktopDeviceAuthorizations)
      .set({
        status: "completed",
        userId: authUserId,
        encryptedApiKey,
      })
      .where(eq(desktopDeviceAuthorizations.pk, row.pk));

    return c.json({ ok: true });
  });
}
