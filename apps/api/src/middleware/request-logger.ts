import { randomUUID } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { LogSampleRules } from "../lib/log-sample-rules.js";
import { logger } from "../lib/logger.js";

import type { AppBindings } from "../types.js";

const slowRequestThresholdMs = Number.parseInt(
  process.env.REQUEST_LOG_SLOW_MS ?? "300",
  10,
);

const logSampleRules = new LogSampleRules(
  [
    {
      path: "/health",
      sample: { rate: 0 },
      skipBelowMs: slowRequestThresholdMs,
    },
    {
      path: "/api/internal/pools/heartbeat",
      sample: { rate: 0 },
      skipBelowMs: slowRequestThresholdMs,
    },
    {
      path: "/api/internal/pools/:poolId/config/latest",
      sample: { rate: 0 },
      skipBelowMs: slowRequestThresholdMs,
    },
    {
      path: "/api/internal/skills/latest",
      sample: { rate: 0.05 },
      skipBelowMs: slowRequestThresholdMs,
    },
    {
      path: "/api/internal/sessions/sync-discord",
      sample: { rate: 0.2 },
      skipBelowMs: slowRequestThresholdMs,
    },
    {
      path: "/api/*",
      sample: { rate: 1 },
    },
    {
      path: "/*",
      sample: { rate: 1 },
    },
  ],
  {
    sample: { rate: 1 },
    skipBelowMs: 0,
    sampleStatusAllowlist: [200, 201, 204],
  },
);

export const requestLoggerMiddleware: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  const startedAt = Date.now();
  const requestId =
    c.get("requestId") ?? c.req.header("x-request-id") ?? randomUUID();
  let threw = false;

  c.set("requestId", requestId);
  c.header("x-request-id", requestId);

  try {
    await next();
  } catch (error) {
    threw = true;
    throw error;
  } finally {
    const latencyMs = Date.now() - startedAt;
    const method = c.req.method;
    const path = c.req.path;
    const status = threw ? 500 : c.res.status;
    const decision = logSampleRules.get(path, status, latencyMs);

    if (decision.shouldLog) {
      logger.info({
        message: "http_request",
        request_id: requestId,
        method,
        path,
        status,
        latency_ms: latencyMs,
      });
    }
  }
};
