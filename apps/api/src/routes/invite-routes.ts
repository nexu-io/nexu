import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  validateInviteResponseSchema,
  validateInviteSchema,
} from "@nexu/shared";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { inviteCodes, users } from "../db/schema/index.js";

import type { AppBindings } from "../types.js";

const validateInviteRoute = createRoute({
  method: "post",
  path: "/v1/invite/validate",
  tags: ["Invite"],
  request: {
    body: {
      content: { "application/json": { schema: validateInviteSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: validateInviteResponseSchema },
      },
      description: "Validation result",
    },
  },
});

export function registerInviteRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(validateInviteRoute, async (c) => {
    const { code } = c.req.valid("json");
    const normalizedCode = code.trim().toUpperCase();

    const [invite] = await db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.code, normalizedCode));

    if (!invite) {
      return c.json({ valid: false, message: "Invalid invite code" }, 200);
    }

    if (
      invite.maxUses !== null &&
      invite.usedCount !== null &&
      invite.usedCount >= invite.maxUses
    ) {
      return c.json(
        { valid: false, message: "Invite code has been fully used" },
        200,
      );
    }

    if (invite.expiresAt && new Date(invite.expiresAt) < new Date()) {
      return c.json({ valid: false, message: "Invite code has expired" }, 200);
    }

    // Increment used count
    await db
      .update(inviteCodes)
      .set({ usedCount: sql`${inviteCodes.usedCount} + 1` })
      .where(eq(inviteCodes.id, invite.id));

    // Record invite acceptance for the current user
    const authUserId = c.get("userId");
    const now = new Date().toISOString();
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.authUserId, authUserId));

    if (existing) {
      await db
        .update(users)
        .set({ inviteAcceptedAt: now, updatedAt: now })
        .where(eq(users.authUserId, authUserId));
    } else {
      await db.insert(users).values({
        id: crypto.randomUUID(),
        authUserId,
        inviteAcceptedAt: now,
      });
    }

    return c.json({ valid: true }, 200);
  });
}
