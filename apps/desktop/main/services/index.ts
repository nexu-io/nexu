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
  checkCriticalPathsLocked,
  stopAllServices,
  teardownLaunchdServices,
  ensureNexuProcessesDead,
  getDefaultPlistDir,
  getLogDir,
  type LaunchdBootstrapEnv,
  type LaunchdBootstrapResult,
} from "./launchd-bootstrap";

export {
  installLaunchdQuitHandler,
  quitWithDecision,
  runTeardownAndExit,
  type QuitHandlerOptions,
  type QuitDecision,
} from "./quit-handler";
