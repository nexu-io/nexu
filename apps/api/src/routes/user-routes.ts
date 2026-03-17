import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  updateAuthSourceResponseSchema,
  updateAuthSourceSchema,
  userProfileResponseSchema,
} from "@nexu/shared";
import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema/index.js";
import type { AppBindings } from "../types.js";

const getMeRoute = createRoute({
  method: "get",
  path: "/api/v1/me",
  tags: ["User"],
  responses: {
    200: {
      content: {
        "application/json": { schema: userProfileResponseSchema },
      },
      description: "Current user profile",
    },
  },
});

const updateAuthSourceRoute = createRoute({
  method: "post",
  path: "/api/v1/me/auth-source",
  tags: ["User"],
  request: {
    body: {
      content: { "application/json": { schema: updateAuthSourceSchema } },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": { schema: updateAuthSourceResponseSchema },
      },
      description: "Auth source updated",
    },
  },
});

export function registerUserRoutes(app: OpenAPIHono<AppBindings>) {
  app.openapi(getMeRoute, async (c) => {
    const authUserId = c.get("userId");
    const session = c.get("session");

    let [appUser] = await db
      .select()
      .from(users)
      .where(eq(users.authUserId, authUserId));

    // Auto-create Nexu user record on first visit (no invite code required)
    if (!appUser) {
      const now = new Date().toISOString();
      await db.insert(users).values({
        id: createId(),
        authUserId,
        inviteAcceptedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      [appUser] = await db
        .select()
        .from(users)
        .where(eq(users.authUserId, authUserId));
    }

    return c.json(
      {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image ?? null,
        plan: appUser?.plan ?? "free",
        inviteAccepted: true,
        onboardingCompleted: appUser?.onboardingCompletedAt != null,
        authSource: appUser?.authSource ?? null,
      },
      200,
    );
  });

  app.openapi(updateAuthSourceRoute, async (c) => {
    const authUserId = c.get("userId");
    const input = c.req.valid("json");
    const now = new Date().toISOString();

    await db
      .update(users)
      .set({
        authSource: input.source,
        authSourceDetail: input.detail ?? null,
        updatedAt: now,
      })
      .where(eq(users.authUserId, authUserId));

    return c.json({ ok: true }, 200);
  });
}
