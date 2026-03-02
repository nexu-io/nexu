import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { logger } from "../lib/logger.js";

const slowRequestThresholdMs = Number.parseInt(
  process.env.REQUEST_LOG_SLOW_MS ?? "300",
  10,
);

function shouldSkipPath(path: string, status: number): boolean {
  if (status >= 400) return false;
  if (path === "/health") return true;
  if (path === "/api/internal/pools/heartbeat") return true;
  if (
    path.startsWith("/api/internal/pools/") &&
    path.endsWith("/config/latest")
  ) {
    return true;
  }

  return false;
}

export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const startedAt = Date.now();
  const requestId = c.req.header("x-request-id") ?? randomUUID();

  c.set("requestId", requestId);
  c.header("x-request-id", requestId);

  await next();

  const latencyMs = Date.now() - startedAt;
  const method = c.req.method;
  const path = c.req.path;
  const status = c.res.status;

  if (shouldSkipPath(path, status) && latencyMs < slowRequestThresholdMs) {
    return;
  }

  logger.info({
    message: "http_request",
    request_id: requestId,
    method,
    path,
    status,
    latency_ms: latencyMs,
  });
};
