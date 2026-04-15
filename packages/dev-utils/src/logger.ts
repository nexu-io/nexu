import pino from "pino";

export type DevLoggerBindings = Record<string, unknown>;

export type DevLogFields = Record<string, unknown>;

export type DevLogger = {
  debug(message: string, fields?: DevLogFields): void;
  info(message: string, fields?: DevLogFields): void;
  warn(message: string, fields?: DevLogFields): void;
  error(message: string, fields?: DevLogFields): void;
  child(bindings: DevLoggerBindings): DevLogger;
};

type CreateDevLoggerOptions = {
  level?: string;
  pretty?: boolean;
  bindings?: DevLoggerBindings;
};

function wrapPinoLogger(logger: pino.Logger): DevLogger {
  return {
    debug(message, fields) {
      logger.debug(fields ?? {}, message);
    },
    info(message, fields) {
      logger.info(fields ?? {}, message);
    },
    warn(message, fields) {
      logger.warn(fields ?? {}, message);
    },
    error(message, fields) {
      logger.error(fields ?? {}, message);
    },
    child(bindings) {
      return wrapPinoLogger(logger.child(bindings));
    },
  };
}

export function createDevLogger(
  options: CreateDevLoggerOptions = {},
): DevLogger {
  const destination = options.pretty
    ? pino.transport({
        target: "pino-pretty",
        options: {
          colorize: false,
          ignore: "pid,hostname",
          messageFormat: "{msg}",
          translateTime: "SYS:standard",
          singleLine: true,
        },
      })
    : undefined;

  return wrapPinoLogger(
    pino(
      {
        name: "tools-dev",
        level: options.level ?? "info",
        base: options.bindings ?? undefined,
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      destination,
    ),
  );
}
