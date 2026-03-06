import type { OpenAPIHono } from "@hono/zod-openapi";
import { auth } from "../auth.js";
import { pool } from "../db/index.js";
import type { AppBindings } from "../types.js";

export function registerAuthRoutes(app: OpenAPIHono<AppBindings>) {
  // Public endpoint: check if an email is already registered and verified.
  // Used by the signup form to distinguish "verified user" from "unverified user".
  app.post("/api/auth/check-email", async (c) => {
    const body = await c.req.json<{ email?: string }>();
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
