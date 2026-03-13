import pino from "pino";

const env = process.env.DD_ENV ?? process.env.NODE_ENV ?? "development";
const version =
  process.env.DD_VERSION ??
  process.env.COMMIT_HASH ??
  process.env.GIT_COMMIT_SHA ??
  process.env.IMAGE_TAG ??
  process.env.npm_package_version;

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env === "production" ? "info" : "debug"),
  base: {
    service: "nexu-gateway",
    env,
    log_source: "gateway",
    ...(version ? { version } : {}),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(env !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname,service,env,log_source,version",
            translateTime: "HH:MM:ss.l",
          },
        },
      }
    : {}),
});

type ErrorContext = Record<string, unknown>;

type BaseErrorInput = {
  type: string;
  code?: string;
  context?: ErrorContext;
};

type GatewayErrorFixedFields = {
  source: string;
  message: string;
  code?: string;
};

type ErrorLike = {
  message?: unknown;
  code?: unknown;
};

export class BaseError extends Error {
  readonly type: string;

  readonly code?: string;

  readonly context: ErrorContext;

  constructor(message: string, input: BaseErrorInput) {
    super(message);
    this.name = new.target.name;
    this.type = input.type;
    this.code = input.code;
    this.context = input.context ?? {};
  }

  static from(error: unknown): BaseError {
    if (error instanceof BaseError) {
      return error;
    }

    if (error instanceof Error) {
      return new BaseError(error.message || "unknown_error", {
        type: "base_error",
      });
    }

    if (typeof error === "object" && error !== null) {
      const errorLike = error as ErrorLike;
      const message =
        typeof errorLike.message === "string" && errorLike.message.length > 0
          ? errorLike.message
          : "unknown_error";
      const code =
        typeof errorLike.code === "string" && errorLike.code.length > 0
          ? errorLike.code
          : undefined;
      return new BaseError(message, {
        type: "base_error",
        code,
      });
    }

    return new BaseError("unknown_error", {
      type: "base_error",
    });
  }

  toJSON(): {
    error_type: string;
    error: string;
    error_code?: string;
    error_context?: ErrorContext;
  } {
    return {
      error_type: this.type,
      error: this.message,
      ...(this.code ? { error_code: this.code } : {}),
      ...(Object.keys(this.context).length > 0
        ? { error_context: this.context }
        : {}),
    };
  }
}

export class GatewayError extends BaseError {
  readonly source: string;

  readonly context: ErrorContext;

  constructor(fixed: GatewayErrorFixedFields, context: ErrorContext = {}) {
    super(fixed.message, {
      type: "gateway_error",
      code: fixed.code,
      context,
    });
    this.source = fixed.source;
    this.context = context;
  }

  static from(
    fixed: GatewayErrorFixedFields,
    context: ErrorContext = {},
  ): GatewayError {
    return new GatewayError(fixed, context);
  }

  override toJSON(): {
    error_type: string;
    error_source: string;
    error: string;
    error_code?: string;
    error_context?: ErrorContext;
  } {
    return {
      ...super.toJSON(),
      error_source: this.source,
    };
  }
}
