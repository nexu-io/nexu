import type { App } from "electron";
import type { BrowserWindow } from "electron";
import type { DesktopRuntimeConfig } from "../../shared/runtime-config";
import type { DesktopDiagnosticsReporter } from "../desktop-diagnostics";
import type { RuntimeOrchestrator } from "../runtime/daemon-supervisor";
import type {
  DesktopPortAllocationResult,
  PortAllocation,
} from "../runtime/port-allocation";
import type { LaunchdBootstrapResult } from "../services";

export type RuntimeConfigPreparation = {
  allocations: PortAllocation[];
  runtimeConfig: DesktopRuntimeConfig;
};

export type RuntimeResidencyMode = "managed" | "launchd" | "external";

export type PackagedArchiveFormat = "tar.gz" | "zip";

export type DesktopRuntimeRoots = {
  nexuHome: string;
  runtimeRoot: string;
  openclawRuntimeRoot: string;
  openclawStateDir: string;
  openclawConfigPath: string;
  openclawTmpDir: string;
  webRoot: string;
  logsRoot: string;
};

export type MaterializePackagedSidecarArgs = {
  runtimeSidecarBaseRoot: string;
  runtimeRoot: string;
};

export type ResolveRuntimeExecutablesArgs = {
  electronRoot: string;
  isPackaged: boolean;
  openclawSidecarRoot: string;
  inheritedNodePath?: string;
};

export type DesktopSidecarMaterializer = {
  materializePackagedOpenclawSidecar: (
    args: MaterializePackagedSidecarArgs,
  ) => Promise<string>;
  materializePackagedOpenclawSidecarSync?: (
    args: MaterializePackagedSidecarArgs,
  ) => string;
};

export type DesktopRuntimeExecutableResolver = {
  resolveSkillNodePath: (args: ResolveRuntimeExecutablesArgs) => string;
  resolveOpenclawNodePath: (
    args: ResolveRuntimeExecutablesArgs,
  ) => string | undefined;
};

export type DesktopRuntimePortStrategy = {
  allocateRuntimePorts: (
    args: PrepareRuntimeConfigArgs,
  ) => Promise<DesktopPortAllocationResult>;
};

export type RunStateMigrationArgs = {
  runtimeConfig: DesktopRuntimeConfig;
  runtimeRoots: DesktopRuntimeRoots;
  isPackaged: boolean;
  log: (message: string) => void;
};

export type DesktopRuntimeStateMigrationPolicy = {
  run: (args: RunStateMigrationArgs) => void;
};

export type InstallShutdownCoordinatorArgs = {
  app: App;
  mainWindow: BrowserWindow;
  launchdResult: LaunchdBootstrapResult | null;
  orchestrator: RuntimeOrchestrator;
  diagnosticsReporter: DesktopDiagnosticsReporter | null;
  sleepGuardDispose: (reason: string) => void;
  flushRuntimeLoggers: () => void;
};

export type DesktopShutdownCoordinator = {
  install: (args: InstallShutdownCoordinatorArgs) => void;
};

export type PlatformCapabilitiesArgs = {
  app: App;
  electronRoot: string;
  runtimeConfig: DesktopRuntimeConfig;
};

export type DesktopPlatformCapabilities = {
  platformId: "mac" | "win" | "default";
  runtimeResidency: RuntimeResidencyMode;
  packagedArchive: {
    format: PackagedArchiveFormat;
    extractionMode: "sync" | "async";
    supportsAtomicSwap: boolean;
  };
  resolveRuntimeRoots: (args: PlatformCapabilitiesArgs) => DesktopRuntimeRoots;
  sidecarMaterializer: DesktopSidecarMaterializer;
  runtimeExecutables: DesktopRuntimeExecutableResolver;
  portStrategy: DesktopRuntimePortStrategy;
  stateMigrationPolicy: DesktopRuntimeStateMigrationPolicy;
  shutdownCoordinator: DesktopShutdownCoordinator;
};

export type PlatformColdStartResult = {
  launchdResult: LaunchdBootstrapResult | null;
};

export type PrepareRuntimeConfigArgs = {
  baseRuntimeConfig: DesktopRuntimeConfig;
  env: NodeJS.ProcessEnv;
  logStartupStep: (message: string) => void;
};

export type RunPlatformColdStartArgs = {
  app: App;
  electronRoot: string;
  runtimeConfig: DesktopRuntimeConfig;
  orchestrator: RuntimeOrchestrator;
  diagnosticsReporter: DesktopDiagnosticsReporter | null;
  logColdStart: (message: string) => void;
  logStartupStep: (message: string) => void;
  rotateDesktopLogSession: () => string;
  waitForControllerReadiness: () => Promise<void>;
};

export type DesktopRuntimePlatformAdapter = {
  id: "mac" | "win" | "default";
  mode: RuntimeResidencyMode;
  capabilities: DesktopPlatformCapabilities;
  prepareRuntimeConfig: (
    args: PrepareRuntimeConfigArgs,
  ) => Promise<RuntimeConfigPreparation>;
  runColdStart: (
    args: RunPlatformColdStartArgs,
  ) => Promise<PlatformColdStartResult>;
};
