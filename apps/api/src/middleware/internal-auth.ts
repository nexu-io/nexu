import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

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
  const expectedToken = process.env.INTERNAL_TRPC_TOKEN;
  if (!expectedToken) {
    throw new HTTPException(500, {
      message: "INTERNAL_TRPC_TOKEN is not configured",
    });
  }

  const actualToken = readToken(c);
  if (!actualToken || actualToken !== expectedToken) {
    throw new HTTPException(401, { message: "Unauthorized internal request" });
  }
}
