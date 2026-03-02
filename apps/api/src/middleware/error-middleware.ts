import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { BaseError, MiddlewareError } from "../lib/error.js";
import { logger } from "../lib/logger.js";
import type { AppBindings } from "../types.js";

type ErrorHttpStatus = 400 | 401 | 403 | 404 | 500;

export type ErrorPolicy = {
  resolveStatus?: (
    error: BaseError,
    c: Context<AppBindings>,
  ) => ErrorHttpStatus;
  resolveLevel?: (
    error: BaseError,
    status: number,
    c: Context<AppBindings>,
  ) => "error" | "warn" | "info";
};

export const defaultErrorPolicy: Required<ErrorPolicy> = {
  resolveStatus(error): ErrorHttpStatus {
    if (error instanceof MiddlewareError) {
      const code = error.context.code;
      if (code === "unauthorized" || code === "internal_token_invalid") {
        return 401;
      }
      if (code === "internal_token_not_configured") {
        return 500;
      }
    }

    if (
      error.type === "service_error" &&
      error.context.code === "pool_not_found"
    ) {
      return 404;
    }

    if (
      error.type === "entry_error" &&
      typeof error.context.status === "number"
    ) {
      const status = error.context.status;
      if (
        status === 400 ||
        status === 401 ||
        status === 403 ||
        status === 404 ||
        status === 500
      ) {
        return status;
      }
    }

    return 500;
  },
  resolveLevel(_error, status) {
    if (status >= 500) return "error";
    if (status >= 400) return "warn";
    return "info";
  },
};

export function mergeErrorPolicy(policy?: ErrorPolicy): Required<ErrorPolicy> {
  return {
    resolveStatus: policy?.resolveStatus ?? defaultErrorPolicy.resolveStatus,
    resolveLevel: policy?.resolveLevel ?? defaultErrorPolicy.resolveLevel,
  };
}

function getStackLimitLines(): number {
  const raw = process.env.LOG_ERROR_STACK_LIMIT_LINES ?? "0";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function trimStack(
  stack: string | undefined,
  lineLimit: number,
): string | undefined {
  if (!stack) return undefined;
  if (lineLimit === 0) return stack;
  const lines = stack.split("\n");
  return lines.slice(0, lineLimit).join("\n");
}

function buildErrorBody(
  baseError: BaseError,
  stackLineLimit: number,
): {
  error: Record<string, unknown>;
} {
  const raw = baseError.toJSON();
  const { stack: rawStack, ...rest } = raw.error;
  const stack = typeof rawStack === "string" ? rawStack : undefined;
  const trimmed = trimStack(stack, stackLineLimit);

  return {
    error: {
      ...rest,
      ...(trimmed ? { stack: trimmed } : {}),
    },
  };
}

function buildResponseBody(
  baseError: BaseError,
  requestId: string | undefined,
): {
  message: string;
  requestId?: string;
} {
  return {
    message: baseError.message,
    ...(requestId ? { requestId } : {}),
  };
}

export function resolveErrorHandling(
  c: Context<AppBindings>,
  error: unknown,
): {
  baseError: BaseError;
  status: ErrorHttpStatus;
  level: "error" | "warn" | "info";
  logBody: { error: Record<string, unknown> };
  responseBody: {
    message: string;
    requestId?: string;
  };
} {
  const baseError = BaseError.from(error);
  const policy = mergeErrorPolicy(c.get("errorPolicy"));
  const status = policy.resolveStatus(baseError, c);
  const stackLineLimit = getStackLimitLines();
  const requestId = c.get("requestId");

  return {
    baseError,
    status,
    level: policy.resolveLevel(baseError, status, c),
    logBody: buildErrorBody(baseError, stackLineLimit),
    responseBody: buildResponseBody(baseError, requestId),
  };
}

export function logHandledError(
  c: Context<AppBindings>,
  level: "error" | "warn" | "info",
  body: { error: Record<string, unknown> },
): void {
  logger[level]({
    message: "request_failed",
    request_id: c.get("requestId"),
    path: c.req.path,
    method: c.req.method,
    ...body,
  });
}

export const errorMiddleware = createMiddleware<AppBindings>(
  async (c, next) => {
    if (!c.get("errorPolicy")) {
      c.set("errorPolicy", defaultErrorPolicy);
    }
    await next();
  },
);
