import { resolve } from "node:path";
import { getOpenclawSkillsDir } from "../../../shared/desktop-paths";
import { getWorkspaceRoot } from "../../../shared/workspace-paths";
import {
  SERVICE_LABELS,
  bootstrapWithLaunchd,
  getDefaultPlistDir,
  getLogDir,
  isLaunchdBootstrapEnabled,
  resolveLaunchdPaths,
} from "../../services";
import { createManagedRuntimePlatformAdapter } from "../shared/runtime-common";
import type { DesktopRuntimePlatformAdapter } from "../types";
import {
  createMacLaunchdCapabilities,
  createMacManagedCapabilities,
} from "./capabilities";

export function createMacRuntimePlatformAdapter(): DesktopRuntimePlatformAdapter {
  const capabilities = createMacLaunchdCapabilities();
  return {
    id: "mac",
    mode: "launchd",
    capabilities,
    prepareRuntimeConfig: ({ baseRuntimeConfig, logStartupStep }) => {
      logStartupStep("mac:prepareRuntimeConfig:launchd");
      return Promise.resolve({
        allocations: [],
        runtimeConfig: baseRuntimeConfig,
      });
    },
    async runColdStart({
      app,
      diagnosticsReporter,
      electronRoot,
      logColdStart,
      runtimeConfig,
      orchestrator,
      rotateDesktopLogSession,
    }) {
      diagnosticsReporter?.markColdStartRunning("launchd bootstrap");
      logColdStart("starting launchd bootstrap");

      const isDev = !app.isPackaged;
      const paths = resolveLaunchdPaths(app.isPackaged, electronRoot);
      const runtimeRoots = capabilities.resolveRuntimeRoots({
        app,
        electronRoot,
        runtimeConfig,
      });
      const nexuHome = runtimeRoots.nexuHome;
      const openclawRuntimeRoot = runtimeRoots.openclawRuntimeRoot;
      const openclawStateDir = runtimeRoots.openclawStateDir;
      const openclawConfigPath = runtimeRoots.openclawConfigPath;

      capabilities.stateMigrationPolicy.run({
        runtimeConfig,
        runtimeRoots,
        isPackaged: app.isPackaged,
        log: logColdStart,
      });

      const webRoot = runtimeRoots.webRoot;
      const repoRoot = getWorkspaceRoot();
      const userDataPath = app.getPath("userData");
      const openclawSkillsDir = getOpenclawSkillsDir(userDataPath);
      const openclawTmpDir = runtimeRoots.openclawTmpDir;
      const openclawBinPath =
        process.env.NEXU_OPENCLAW_BIN ??
        resolve(paths.openclawCwd, "bin/openclaw");
      const openclawPackageRoot = resolve(
        paths.openclawCwd,
        "node_modules/openclaw",
      );
      const openclawExtensionsDir = resolve(openclawPackageRoot, "extensions");
      const skillhubStaticSkillsDir = app.isPackaged
        ? resolve(electronRoot, "static/bundled-skills")
        : resolve(repoRoot, "apps/desktop/static/bundled-skills");
      const platformTemplatesDir = app.isPackaged
        ? resolve(electronRoot, "static/platform-templates")
        : resolve(repoRoot, "apps/controller/static/platform-templates");
      const skillNodePath =
        capabilities.runtimeExecutables.resolveSkillNodePath({
          electronRoot,
          isPackaged: app.isPackaged,
          openclawSidecarRoot: paths.openclawCwd,
        });

      const launchdResult = await bootstrapWithLaunchd({
        isDev,
        controllerPort: runtimeConfig.ports.controller,
        openclawPort: Number(
          new URL(runtimeConfig.urls.openclawBase).port || 18789,
        ),
        nexuHome,
        gatewayToken: isDev ? undefined : runtimeConfig.tokens.gateway,
        webPort: runtimeConfig.ports.web,
        webRoot,
        plistDir: getDefaultPlistDir(isDev),
        ...paths,
        openclawConfigPath,
        openclawStateDir,
        webUrl: runtimeConfig.urls.web,
        openclawSkillsDir,
        skillhubStaticSkillsDir,
        platformTemplatesDir,
        openclawBinPath,
        openclawExtensionsDir,
        skillNodePath,
        openclawTmpDir,
      });

      orchestrator.enableLaunchdMode(
        launchdResult.launchd,
        {
          controller: SERVICE_LABELS.controller(isDev),
          openclaw: SERVICE_LABELS.openclaw(isDev),
        },
        getLogDir(isDev ? nexuHome : undefined),
      );

      const { controllerPort, openclawPort, webPort } =
        launchdResult.effectivePorts;
      runtimeConfig.ports.controller = controllerPort;
      runtimeConfig.ports.web = webPort;
      runtimeConfig.urls.controllerBase = `http://127.0.0.1:${controllerPort}`;
      runtimeConfig.urls.web = `http://127.0.0.1:${webPort}`;
      runtimeConfig.urls.openclawBase = `http://127.0.0.1:${openclawPort}`;

      if (launchdResult.isAttach) {
        logColdStart(
          `attached to running services (controller=${controllerPort} openclaw=${openclawPort} web=${webPort})`,
        );
      } else {
        logColdStart(
          "launchd services started, waiting for controller readiness",
        );
        diagnosticsReporter?.markColdStartRunning(
          "waiting for controller readiness",
        );
        await launchdResult.controllerReady;
        logColdStart("controller ready");
      }

      const sessionId = rotateDesktopLogSession();
      logColdStart(`launchd cold start complete sessionId=${sessionId}`);
      diagnosticsReporter?.markColdStartSucceeded();

      return {
        launchdResult,
      };
    },
  };
}

export function shouldUseMacLaunchdRuntime(): boolean {
  return process.platform === "darwin" && isLaunchdBootstrapEnabled();
}

export function createFallbackMacRuntimePlatformAdapter() {
  return createManagedRuntimePlatformAdapter(
    "mac",
    createMacManagedCapabilities(),
  );
}
