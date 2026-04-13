import type {
  DesktopRuntimeLifecycleContract,
  DesktopRuntimePlatformId,
  DesktopRuntimeResidency,
  DesktopRuntimeSessionSnapshot,
  DesktopRuntimeTeardownReason,
} from "@nexu/shared";
import type { App } from "electron";
import type { BrowserWindow } from "electron";
import type { DesktopRuntimeConfig } from "../../shared/runtime-config";
import type { DesktopDiagnosticsReporter } from "../desktop-diagnostics";
import type { RuntimeOrchestrator } from "../runtime/daemon-supervisor";
import type {
  DesktopPortAllocationResult,
  PortAllocation,
} from "../runtime/port-allocation";
import type { EmbeddedWebServer } from "../services/embedded-web-server";

export type DesktopRuntimeSupervisor = {
  bootoutService: (label: string) => Promise<void>;
  waitForExit: (label: string, timeoutMs?: number) => Promise<void>;
};

export type DesktopRuntimeResidencyContext = {
  serviceSupervisor: DesktopRuntimeSupervisor;
  serviceLabels: {
    controller: string;
    openclaw: string;
  };
  embeddedWebServer?: EmbeddedWebServer;
  controllerReady: Promise<{ ok: true } | { ok: false; error: Error }>;
  effectivePorts: {
    controllerPort: number;
    openclawPort: number;
    webPort: number;
  };
  attached: boolean;
} | null;

export type RuntimeConfigPreparation = {
  allocations: PortAllocation[];
  runtimeConfig: DesktopRuntimeConfig;
};

export type RuntimeResidencyMode = DesktopRuntimeResidency;

export type PackagedArchiveFormat = "tar.gz" | "zip";

export type DesktopRuntimeRoots = {
  userDataRoot: string;
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

export type PendingUserDataMigrationContext = {
  sourceDir: string;
  targetDir: string;
  strategy: "move" | "copy" | "noop";
};

export type RunStateMigrationArgs = {
  runtimeConfig: DesktopRuntimeConfig;
  runtimeRoots: DesktopRuntimeRoots;
  isPackaged: boolean;
  log: (message: string) => void;
  pendingUserDataMigration: PendingUserDataMigrationContext | null;
};

export type DesktopRuntimeStateMigrationPolicy = {
  run: (args: RunStateMigrationArgs) => void;
};

export type InstallShutdownCoordinatorArgs = {
  app: App;
  mainWindow: BrowserWindow;
  residencyContext: DesktopRuntimeResidencyContext;
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
  platformId: DesktopRuntimePlatformId;
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
  residencyContext: DesktopRuntimeResidencyContext;
};

export type RecoverPlatformSessionArgs = {
  app: App;
  electronRoot: string;
  runtimeConfig: DesktopRuntimeConfig;
  logLifecycleStep: (message: string) => void;
};

export type RecoverPlatformSessionResult = {
  recovered: boolean;
  snapshot: DesktopRuntimeSessionSnapshot | null;
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

export type PrepareForUpdateInstallArgs = {
  app: App;
  orchestrator: RuntimeOrchestrator;
  logLifecycleStep: (message: string) => void;
};

export type PrepareForUpdateInstallResult = {
  handled: boolean;
};

export type RuntimeTeardownArgs = InstallShutdownCoordinatorArgs & {
  reason: DesktopRuntimeTeardownReason;
};

export type RuntimeTeardownResult = {
  handled: boolean;
};

export type DesktopRuntimeLifecycle = DesktopRuntimeLifecycleContract<
  PrepareRuntimeConfigArgs,
  RuntimeConfigPreparation,
  RunPlatformColdStartArgs,
  PlatformColdStartResult,
  InstallShutdownCoordinatorArgs,
  void,
  void,
  RecoverPlatformSessionArgs,
  RecoverPlatformSessionResult,
  PrepareForUpdateInstallArgs,
  PrepareForUpdateInstallResult,
  RuntimeTeardownArgs,
  RuntimeTeardownResult
>;

export type DesktopRuntimePlatformAdapter = {
  id: DesktopRuntimePlatformId;
  capabilities: DesktopPlatformCapabilities;
  lifecycle: DesktopRuntimeLifecycle;
};
