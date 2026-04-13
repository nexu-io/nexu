import { type DevLogger, createDevLogger } from "@nexu/dev-utils";

import { getScriptsDevRuntimeConfig } from "./dev-runtime-config.js";

export const logger: DevLogger = createDevLogger({
  level: getScriptsDevRuntimeConfig().devLogLevel,
  pretty: getScriptsDevRuntimeConfig().devLogPretty,
  bindings: { scope: "scripts-dev" },
});
