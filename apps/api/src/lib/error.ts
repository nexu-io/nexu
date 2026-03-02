export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ErrorContext = Record<string, JsonValue>;

type BaseErrorOptions = {
  type: string;
  context?: ErrorContext;
  cause?: unknown;
};

function resolveMessage(fallback: string, context: ErrorContext): string {
  if (typeof context.message === "string") {
    return context.message;
  }
  if (typeof context.code === "string") {
    return context.code;
  }
  return fallback;
}

export class BaseError extends Error {
  readonly type: string;
  readonly context: ErrorContext;
  override readonly cause?: unknown;

  constructor(message: string, options: BaseErrorOptions) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.type = options.type;
    this.context = options.context ?? {};
    this.cause = options.cause;
  }

  static from(e: unknown): BaseError {
    if (e instanceof BaseError) {
      return e;
    }
    return UnknownError.from("base", {}, { cause: e });
  }

  toJSON(): { error: Record<string, JsonValue> } {
    const stack = typeof this.stack === "string" ? this.stack : undefined;

    return {
      error: {
        type: this.type,
        message: this.message,
        context: this.context,
        ...(stack ? { stack } : {}),
      },
    };
  }
}

export class EntryError extends BaseError {
  readonly entryPoint: string;

  constructor(entryPoint: string, context: ErrorContext, cause?: unknown) {
    super(resolveMessage(`Entry error at ${entryPoint}`, context), {
      type: "entry_error",
      context: { entryPoint, ...context },
      cause,
    });
    this.entryPoint = entryPoint;
  }

  static from(
    entryPoint: string,
    context: ErrorContext = {},
    options?: { cause?: unknown },
  ): EntryError {
    return new EntryError(entryPoint, context, options?.cause);
  }
}

export class MiddlewareError extends BaseError {
  readonly middlewareName: string;

  constructor(middlewareName: string, context: ErrorContext, cause?: unknown) {
    super(resolveMessage(`Middleware error in ${middlewareName}`, context), {
      type: "middleware_error",
      context: { middlewareName, ...context },
      cause,
    });
    this.middlewareName = middlewareName;
  }

  static from(
    middlewareName: string,
    context: ErrorContext = {},
    options?: { cause?: unknown },
  ): MiddlewareError {
    return new MiddlewareError(middlewareName, context, options?.cause);
  }
}

export class ServiceError extends BaseError {
  readonly serviceName: string;

  constructor(serviceName: string, context: ErrorContext, cause?: unknown) {
    super(resolveMessage(`Service error in ${serviceName}`, context), {
      type: "service_error",
      context: { serviceName, ...context },
      cause,
    });
    this.serviceName = serviceName;
  }

  static from(
    serviceName: string,
    context: ErrorContext = {},
    options?: { cause?: unknown },
  ): ServiceError {
    return new ServiceError(serviceName, context, options?.cause);
  }
}

export class UnknownError extends BaseError {
  readonly source: string;

  constructor(source: string, context: ErrorContext, cause?: unknown) {
    const message = cause instanceof Error ? cause.message : "Unknown error";
    super(message, {
      type: "unknown_error",
      context: { source, ...context },
      cause,
    });
    this.source = source;
  }

  static from(
    source: string,
    context: ErrorContext = {},
    options?: { cause?: unknown },
  ): UnknownError {
    return new UnknownError(source, context, options?.cause);
  }
}
