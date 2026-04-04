export type DesktopRuntimePlatformId = "mac" | "win";

export type DesktopRuntimeResidency = "managed" | "launchd" | "external";

export type DesktopRuntimeLifecycleStage =
  | "prepare-runtime-config"
  | "materialize-runtime"
  | "recover-session"
  | "cold-start-or-attach"
  | "install-shutdown-coordinator"
  | "prepare-for-update-install"
  | "teardown";

export type DesktopRuntimeSessionTransition =
  | "cold-started"
  | "attached"
  | "recovered";

export type DesktopRuntimeSessionStoreKind = "none" | "runtime-ports-file";

export type DesktopRuntimeTeardownReason =
  | "app-quit"
  | "background"
  | "update-install"
  | "crash-recovery"
  | "stale-session-cleanup";

export interface DesktopRuntimePortBindings {
  controllerPort?: number;
  webPort?: number;
  openclawPort?: number;
}

export interface DesktopRuntimeSessionSnapshot {
  platformId: DesktopRuntimePlatformId;
  residency: DesktopRuntimeResidency;
  transition: DesktopRuntimeSessionTransition;
  store: DesktopRuntimeSessionStoreKind;
  bindings: DesktopRuntimePortBindings;
}

export interface DesktopRuntimeLifecycleContract<
  TPrepareArgs,
  TPrepareResult,
  TColdStartArgs,
  TColdStartResult,
  TInstallShutdownArgs,
  TMaterializeArgs = void,
  TMaterializeResult = void,
  TRecoverArgs = void,
  TRecoverResult = void,
  TPrepareForUpdateArgs = void,
  TPrepareForUpdateResult = void,
  TTeardownArgs = void,
  TTeardownResult = void,
> {
  residency: DesktopRuntimeResidency;
  prepareRuntimeConfig: (args: TPrepareArgs) => Promise<TPrepareResult>;
  materializeRuntime?: (args: TMaterializeArgs) => Promise<TMaterializeResult>;
  recoverSession?: (args: TRecoverArgs) => Promise<TRecoverResult>;
  coldStartOrAttach: (args: TColdStartArgs) => Promise<TColdStartResult>;
  installShutdownCoordinator: (args: TInstallShutdownArgs) => void;
  prepareForUpdateInstall?: (
    args: TPrepareForUpdateArgs,
  ) => Promise<TPrepareForUpdateResult>;
  teardown?: (args: TTeardownArgs) => Promise<TTeardownResult>;
}
