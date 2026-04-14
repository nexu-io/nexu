import { type DevLogger, createDevLogger } from "@nexu/dev-utils";

import { getToolsDevRuntimeConfig } from "./dev-runtime-config.js";

export const logger: DevLogger = createDevLogger({
  level: getToolsDevRuntimeConfig().devLogLevel,
  pretty: getToolsDevRuntimeConfig().devLogPretty,
  bindings: { scope: "tools-dev" },
});
