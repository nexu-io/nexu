import pino from "pino";

const env = process.env.DD_ENV ?? process.env.NODE_ENV ?? "development";
const version = process.env.DD_VERSION ?? process.env.COMMIT_HASH ?? "unknown";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (env === "production" ? "info" : "debug"),
  base: {
    service: "nexu-api",
    env,
    version,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
