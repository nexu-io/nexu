import { randomUUID } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { Trace } from "../lib/trace-decorator.js";

import type { AppBindings } from "../types.js";

type RequestTraceTags = Record<string, unknown>;

function resolveRouteGroup(path: string): "internal" | "v1" | "public" {
  if (path.startsWith("/api/internal/")) {
    return "internal";
  }

  if (path.startsWith("/api/v1/")) {
    return "v1";
  }

  return "public";
}

function buildRequestTraceTags(c: Context<AppBindings>): RequestTraceTags {
  const path = c.req.path;
  const routeGroup = resolveRouteGroup(path);

  return {
    "http.method": c.req.method,
    "http.path": path,
    request_id: c.get("requestId"),
    route_group: routeGroup,
    auth_required: routeGroup === "v1",
  };
}

function createRequestId(c: Context<AppBindings>): string {
  return c.req.header("x-request-id") ?? randomUUID();
}

function ensureRequestId(c: Context<AppBindings>): void {
  if (!c.get("requestId")) {
    c.set("requestId", createRequestId(c));
  }
  c.header("x-request-id", c.get("requestId"));
}

class RequestTraceHandler {
  @Trace("api.request", {
    tags: ([context]) => {
      const c = context as Context<AppBindings>;
      return buildRequestTraceTags(c);
    },
  })
  async handle(
    _c: Context<AppBindings>,
    next: () => Promise<void>,
  ): Promise<void> {
    await next();
  }
}

const handler = new RequestTraceHandler();

export const requestTraceMiddleware: MiddlewareHandler<AppBindings> = async (
  c,
  next,
) => {
  ensureRequestId(c);
  return handler.handle(c, next);
};
