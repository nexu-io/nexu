import { timingSafeEqual } from "node:crypto";
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

function safeCompare(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
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
  if (!actualToken || !safeCompare(actualToken, expectedToken)) {
    throw MiddlewareError.from("internal-auth", {
      code: "internal_token_invalid",
      message: "Unauthorized internal request",
    });
  }
}

export function requireSkillToken(c: Context): void {
  const skillToken = process.env.SKILL_API_TOKEN;
  if (!skillToken) {
    throw MiddlewareError.from("internal-auth", {
      code: "skill_token_not_configured",
      message: "SKILL_API_TOKEN is not configured",
    });
  }

  const actualToken = readToken(c);
  if (!actualToken) {
    throw MiddlewareError.from("internal-auth", {
      code: "skill_token_invalid",
      message: "Unauthorized skill request",
    });
  }

  // Accept either skill token or internal token
  const matchesSkill = safeCompare(actualToken, skillToken);
  const internalToken = process.env.INTERNAL_API_TOKEN;
  const matchesInternal = internalToken
    ? safeCompare(actualToken, internalToken)
    : false;

  if (!matchesSkill && !matchesInternal) {
    throw MiddlewareError.from("internal-auth", {
      code: "skill_token_invalid",
      message: "Unauthorized skill request",
    });
  }
}
