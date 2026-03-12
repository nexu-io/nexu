import pino from "pino";

const env = process.env.DD_ENV ?? process.env.NODE_ENV ?? "development";
const version = process.env.DD_VERSION ?? process.env.COMMIT_HASH ?? "unknown";

function getPinoTransport(): pino.TransportSingleOptions | undefined {
  if (env === "production") return undefined;
  try {
    require.resolve("pino-pretty");
    return {
      target: "pino-pretty",
      options: {
        colorize: true,
        ignore: "pid,hostname,service,env,version",
        translateTime: "HH:MM:ss.l",
      },
    };
  } catch {
    return undefined;
  }
}

const transport = getPinoTransport();

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env === "production" ? "info" : "debug"),
  base: {
    service: "nexu-api",
    env,
    version,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(transport ? { transport } : {}),
});
