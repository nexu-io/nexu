/**
 * Desktop Services - launchd-based process management
 */

export {
  LaunchdManager,
  SERVICE_LABELS,
  type ServiceStatus,
} from "./launchd-manager";

export { generatePlist, type PlistEnv } from "./plist-generator";

export {
  startEmbeddedWebServer,
  type EmbeddedWebServer,
  type EmbeddedWebServerOptions,
} from "./embedded-web-server";

export {
  bootstrapWithLaunchd,
  stopAllServices,
  isLaunchdBootstrapEnabled,
  getDefaultPlistDir,
  getLogDir,
  resolveLaunchdPaths,
  type LaunchdBootstrapEnv,
  type LaunchdBootstrapResult,
} from "./launchd-bootstrap";

export {
  installLaunchdQuitHandler,
  quitWithDecision,
  type QuitHandlerOptions,
  type QuitDecision,
} from "./quit-handler";
