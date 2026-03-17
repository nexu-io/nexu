import { createHash, randomBytes } from "node:crypto";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createId } from "@paralleldrive/cuid2";
import bcrypt from "bcryptjs";
import { eq, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { apiKeys, deviceAuthorizations, users } from "../db/schema/index.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import type { AppBindings } from "../types.js";

/**
 * Public endpoints for the desktop device authorization flow.
 * Registered BEFORE authMiddleware — no session required.
 */
export function registerDesktopDeviceRoutes(app: OpenAPIHono<AppBindings>) {
  // Step 1: Desktop client registers a device before opening the browser.
  app.post("/api/auth/device-register", async (c) => {
    const body = await c.req.json<{
      deviceId?: string;
      deviceSecretHash?: string;
    }>();

    if (!body.deviceId || !body.deviceSecretHash) {
      return c.json(
        { error: "deviceId and deviceSecretHash are required" },
        400,
      );
    }

    // Clean up expired rows opportunistically
    await db
      .delete(deviceAuthorizations)
      .where(lt(deviceAuthorizations.expiresAt, new Date().toISOString()));

    await db.insert(deviceAuthorizations).values({
      id: createId(),
      deviceId: body.deviceId,
      deviceSecretHash: body.deviceSecretHash,
      status: "pending",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });

    return c.json({ ok: true });
  });

  // Step 3: Desktop client polls for authorization result.
  app.post("/api/auth/device-poll", async (c) => {
    const body = await c.req.json<{
      deviceId?: string;
      deviceSecret?: string;
    }>();

    if (!body.deviceId || !body.deviceSecret) {
      return c.json({ error: "deviceId and deviceSecret are required" }, 400);
    }

    const [row] = await db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.deviceId, body.deviceId));

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
        .delete(deviceAuthorizations)
        .where(eq(deviceAuthorizations.pk, row.pk));
      return c.json({ status: "expired" });
    }

    if (row.status === "pending") {
      return c.json({ status: "pending" });
    }

    // Already consumed — treat as expired (one-time retrieval)
    if (row.status === "consumed") {
      return c.json({ status: "expired" });
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

      // Mark as consumed instead of deleting — prevents race with late authorize calls
      await db
        .update(deviceAuthorizations)
        .set({ status: "consumed" })
        .where(eq(deviceAuthorizations.pk, row.pk));

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

    // Find the device authorization (any status)
    const [row] = await db
      .select()
      .from(deviceAuthorizations)
      .where(eq(deviceAuthorizations.deviceId, body.deviceId));

    if (!row) {
      return c.json(
        { error: "授权链接已失效，请关闭此页面并从客户端重新点击登录" },
        404,
      );
    }

    // Already completed or consumed — idempotent success
    if (row.status === "completed" || row.status === "consumed") {
      return c.json({ ok: true });
    }

    if (new Date(row.expiresAt) < new Date()) {
      await db
        .delete(deviceAuthorizations)
        .where(eq(deviceAuthorizations.pk, row.pk));
      return c.json(
        { error: "授权链接已过期，请关闭此页面并从客户端重新点击登录" },
        410,
      );
    }

    // Look up app user, auto-create if missing (e.g. user skipped onboarding)
    let [appUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.authUserId, authUserId));

    if (!appUser) {
      const now = new Date().toISOString();
      const newId = createId();
      await db.insert(users).values({
        id: newId,
        authUserId,
        inviteAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      appUser = { id: newId };
    }

    // Generate API key (bcrypt hash for Link gateway compatibility)
    const rawKey = `nxk_${randomBytes(32).toString("base64url")}`;
    const keyPrefix = rawKey.slice(0, 12);
    const keyHash = bcrypt.hashSync(rawKey, 10);

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
      .update(deviceAuthorizations)
      .set({
        status: "completed",
        userId: authUserId,
        encryptedApiKey,
      })
      .where(eq(deviceAuthorizations.pk, row.pk));

    return c.json({ ok: true });
  });
}
