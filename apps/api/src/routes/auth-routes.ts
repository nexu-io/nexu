import { createRoute } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";
import { auth } from "../auth.js";
import { pool } from "../db/index.js";
import type { AppBindings } from "../types.js";

const checkEmailRoute = createRoute({
  method: "post",
  path: "/api/auth/check-email",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ email: z.string().optional() }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            exists: z.boolean(),
            verified: z.boolean(),
          }),
        },
      },
      description: "Email check result",
    },
  },
});

export function registerAuthRoutes(app: OpenAPIHono<AppBindings>) {
  // Public endpoint: check if an email is already registered and verified.
  app.openapi(checkEmailRoute, async (c) => {
    const body = c.req.valid("json");
    const email = body.email?.trim().toLowerCase();
    if (!email) {
      return c.json({ exists: false, verified: false });
    }
    const result = await pool.query(
      `SELECT "emailVerified" FROM "user" WHERE email = $1 LIMIT 1`,
      [email],
    );
    if (result.rows.length === 0) {
      return c.json({ exists: false, verified: false });
    }
    return c.json({
      exists: true,
      verified: result.rows[0].emailVerified === true,
    });
  });

  app.on(["POST", "GET"], "/api/auth/*", (c) => {
    return auth.handler(c.req.raw);
  });
}
