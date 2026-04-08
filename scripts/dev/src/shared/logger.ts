import { type DevLogger, createDevLogger } from "@nexu/dev-utils";

import { getScriptsDevRuntimeConfig } from "./dev-runtime-config.js";

type LoggerBindings = Record<string, unknown>;

const rootLogger = createDevLogger({
  level: getScriptsDevRuntimeConfig().devLogLevel,
  pretty: getScriptsDevRuntimeConfig().devLogPretty,
  bindings: { scope: "scripts-dev" },
});

export function getScriptsDevLogger(bindings?: LoggerBindings): DevLogger {
  return bindings ? rootLogger.child(bindings) : rootLogger;
}
