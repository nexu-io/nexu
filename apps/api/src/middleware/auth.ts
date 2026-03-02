import { createMiddleware } from "hono/factory";
import { auth } from "../auth.js";
import { MiddlewareError } from "../lib/error.js";

export const authMiddleware = createMiddleware(async (c, next) => {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });

  if (!session?.user) {
    throw MiddlewareError.from("auth", {
      code: "unauthorized",
      message: "Unauthorized",
    });
  }

  c.set("userId", session.user.id);
  c.set("session", session);
  await next();
});
