import type { Context } from "hono";
import { MiddlewareError } from "../lib/error.js";

function readToken(c: Context): string | null {
  const headerToken = c.req.header("x-internal-token");
  if (headerToken) {
    return headerToken;
  }

  const authHeader = c.req.header("authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

export function requireInternalToken(c: Context): void {
  const expectedToken = process.env.INTERNAL_API_TOKEN;
  if (!expectedToken) {
    throw MiddlewareError.from("internal-auth", {
      code: "internal_token_not_configured",
      message: "INTERNAL_API_TOKEN is not configured",
    });
  }

  const actualToken = readToken(c);
  if (!actualToken || actualToken !== expectedToken) {
    throw MiddlewareError.from("internal-auth", {
      code: "internal_token_invalid",
      message: "Unauthorized internal request",
    });
  }
}
