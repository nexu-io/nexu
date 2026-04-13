import { resolve } from "node:path";
import type { App } from "electron";
import { getOpenclawSkillsDir } from "../../../shared/desktop-paths";
import { buildChildProcessProxyEnv } from "../../../shared/proxy-config";
import type { DesktopRuntimeConfig } from "../../../shared/runtime-config";
import { getWorkspaceRoot } from "../../../shared/workspace-paths";
import type {
  LaunchdBootstrapEnv,
  LaunchdBootstrapResult,
} from "../../services";
import type {
  DesktopPlatformCapabilities,
  DesktopRuntimeResidencyContext,
  DesktopRuntimeRoots,
} from "../types";

type LaunchdPathSet = {
  nodePath: string;
  controllerEntryPath: string;
  openclawPath: string;
  controllerCwd: string;
  openclawCwd: string;
  openclawBinPath: string;
  openclawExtensionsDir: string;
};

export function createMacLaunchdResidencyContext(
  bootstrapResult: LaunchdBootstrapResult,
): NonNullable<DesktopRuntimeResidencyContext> {
  return {
    serviceSupervisor: bootstrapResult.launchd,
    serviceLabels: bootstrapResult.labels,
    embeddedWebServer: bootstrapResult.webServer,
    controllerReady: bootstrapResult.controllerReady,
    effectivePorts: bootstrapResult.effectivePorts,
    attached: bootstrapResult.isAttach,
  };
}

export function createMacLaunchdBootstrapEnv(args: {
  app: App;
  electronRoot: string;
  runtimeConfig: DesktopRuntimeConfig;
  runtimeRoots: DesktopRuntimeRoots;
  capabilities: DesktopPlatformCapabilities;
  paths: LaunchdPathSet;
}): LaunchdBootstrapEnv {
  const {
    app,
    electronRoot,
    runtimeConfig,
    runtimeRoots,
    capabilities,
    paths,
  } = args;
  const repoRoot = getWorkspaceRoot();
  const userDataPath = app.getPath("userData");
  const openclawPackageRoot = resolve(
    paths.openclawCwd,
    "node_modules/openclaw",
  );

  return {
    isDev: !app.isPackaged,
    controllerPort: runtimeConfig.ports.controller,
    openclawPort: Number(
      new URL(runtimeConfig.urls.openclawBase).port || 18789,
    ),
    webPort: runtimeConfig.ports.web,
    webRoot: runtimeRoots.webRoot,
    plistDir: undefined,
    nexuHome: runtimeRoots.nexuHome,
    gatewayToken: app.isPackaged ? runtimeConfig.tokens.gateway : undefined,
    openclawConfigPath: runtimeRoots.openclawConfigPath,
    openclawStateDir: runtimeRoots.openclawStateDir,
    webUrl: runtimeConfig.urls.web,
    openclawSkillsDir: getOpenclawSkillsDir(userDataPath),
    skillhubStaticSkillsDir: app.isPackaged
      ? resolve(electronRoot, "static/bundled-skills")
      : resolve(repoRoot, "apps/desktop/static/bundled-skills"),
    platformTemplatesDir: app.isPackaged
      ? resolve(electronRoot, "static/platform-templates")
      : resolve(repoRoot, "apps/controller/static/platform-templates"),
    openclawBinPath:
      process.env.NEXU_OPENCLAW_BIN ??
      resolve(paths.openclawCwd, "bin/openclaw"),
    openclawExtensionsDir: resolve(openclawPackageRoot, "extensions"),
    skillNodePath: capabilities.runtimeExecutables.resolveSkillNodePath({
      electronRoot,
      isPackaged: app.isPackaged,
      openclawSidecarRoot: paths.openclawCwd,
    }),
    proxyEnv: buildChildProcessProxyEnv(runtimeConfig.proxy),
    langfusePublicKey:
      process.env.LANGFUSE_PUBLIC_KEY ??
      runtimeConfig.langfusePublicKey ??
      undefined,
    langfuseSecretKey:
      process.env.LANGFUSE_SECRET_KEY ??
      runtimeConfig.langfuseSecretKey ??
      undefined,
    langfuseBaseUrl:
      process.env.LANGFUSE_BASE_URL ??
      runtimeConfig.langfuseBaseUrl ??
      undefined,
    openclawTmpDir: runtimeRoots.openclawTmpDir,
    nodePath: paths.nodePath,
    controllerEntryPath: paths.controllerEntryPath,
    openclawPath: paths.openclawPath,
    controllerCwd: paths.controllerCwd,
    openclawCwd: paths.openclawCwd,
  };
}
