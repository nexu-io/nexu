import * as amplitude from "@amplitude/unified";
import { Identify } from "@amplitude/unified";
import * as Sentry from "@sentry/electron/renderer";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Toaster, toast } from "sonner";
import type {
  AppInfo,
  DesktopChromeMode,
  DesktopRuntimeConfig,
  DesktopSurface,
  DiagnosticsInfo,
  RuntimeEvent,
  RuntimeLogEntry,
  RuntimeState,
  RuntimeUnitId,
  RuntimeUnitPhase,
  RuntimeUnitSnapshot,
  RuntimeUnitState,
} from "../shared/host";
import { getDesktopSentryBuildMetadata } from "../shared/sentry-build-metadata";
import { SurfaceFrame } from "./components/surface-frame";
import { UpdateBanner } from "./components/update-banner";
import { useAutoUpdate } from "./hooks/use-auto-update";
import {
  checkComponentUpdates,
  getAppInfo,
  getDiagnosticsInfo,
  getRuntimeConfig,
  getRuntimeState,
  installComponent,
  onDesktopCommand,
  onRuntimeEvent,
  showRuntimeLogFile,
  startUnit,
  stopUnit,
  triggerMainProcessCrash,
  triggerRendererProcessCrash,
} from "./lib/host-api";
import { CloudProfilePage } from "./pages/cloud-profile-page";
import "./runtime-page.css";

const amplitudeApiKey = import.meta.env.VITE_AMPLITUDE_API_KEY;
const rendererSentryDsn =
  typeof window === "undefined" ? null : window.nexuHost.bootstrap.sentryDsn;

let rendererSentryInitialized = false;

function initializeRendererSentry(dsn: string): void {
  if (rendererSentryInitialized) {
    return;
  }

  const sentryBuildMetadata = getDesktopSentryBuildMetadata(
    window.nexuHost.bootstrap.buildInfo,
  );

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: sentryBuildMetadata.release,
    ...(sentryBuildMetadata.dist ? { dist: sentryBuildMetadata.dist } : {}),
  });

  Sentry.setContext("build", sentryBuildMetadata.buildContext);

  rendererSentryInitialized = true;
}

if (rendererSentryDsn) {
  initializeRendererSentry(rendererSentryDsn);
}

function maskSentryDsn(dsn: string | null | undefined): string {
  if (!dsn) {
    return "missing";
  }

  const match = dsn.match(/^(https?:\/\/)([^@]+)@(.+)$/);

  if (!match) {
    return "configured";
  }

  const [, protocol, publicKey, hostAndPath] = match;
  const visibleKey = publicKey.slice(-6);
  const maskedKey = `${"*".repeat(Math.max(publicKey.length - 6, 3))}${visibleKey}`;

  return `${protocol}${maskedKey}@${hostAndPath}`;
}

function formatBuildTimestamp(value: string | null | undefined): string {
  if (!value) {
    return "(unknown)";
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return value;
  }

  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  const timezoneOffsetMinutes = -date.getTimezoneOffset();
  const offsetSign = timezoneOffsetMinutes >= 0 ? "+" : "-";
  const offsetHours = String(
    Math.floor(Math.abs(timezoneOffsetMinutes) / 60),
  ).padStart(2, "0");
  const offsetMinutes = String(Math.abs(timezoneOffsetMinutes) % 60).padStart(
    2,
    "0",
  );

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
}

function formatBuildCommit(value: string | null | undefined): string {
  if (!value) {
    return "(unknown)";
  }

  return value.slice(0, 7);
}

if (amplitudeApiKey) {
  amplitude.initAll(amplitudeApiKey, {
    analytics: { autocapture: true },
    sessionReplay: { sampleRate: 1 },
  });
  const env = new Identify();
  env.set("environment", import.meta.env.MODE);
  amplitude.identify(env);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function phaseTone(phase: RuntimeUnitPhase): string {
  switch (phase) {
    case "running":
      return "is-running";
    case "failed":
      return "is-failed";
    case "starting":
    case "stopping":
      return "is-busy";
    default:
      return "is-idle";
  }
}

function kindLabel(unit: RuntimeUnitState): string {
  return `${unit.kind} / ${unit.launchStrategy}`;
}

function formatLogLine(entry: RuntimeLogEntry): string {
  const actionLabel = entry.actionId ? ` [action=${entry.actionId}]` : "";
  return `#${entry.cursor} ${entry.ts} [${entry.stream}] [${entry.kind}] [reason=${entry.reasonCode}]${actionLabel} ${entry.message}`;
}

function logFilterLabel(filter: LogFilter): string {
  switch (filter) {
    case "errors":
      return "Errors";
    case "lifecycle":
      return "Lifecycle";
    default:
      return "All";
  }
}

type LogFilter = "all" | "errors" | "lifecycle";

function mergeUnitSnapshot(
  current: RuntimeUnitState,
  snapshot: RuntimeUnitSnapshot,
): RuntimeUnitState {
  return {
    ...current,
    ...snapshot,
  };
}

function applyRuntimeEvent(
  current: RuntimeState,
  event: RuntimeEvent,
): RuntimeState {
  switch (event.type) {
    case "runtime:unit-state": {
      const existingIndex = current.units.findIndex(
        (unit) => unit.id === event.unit.id,
      );

      if (existingIndex === -1) {
        return current;
      }

      const nextUnits = [...current.units];
      const existingUnit = nextUnits[existingIndex];
      if (!existingUnit) {
        return current;
      }
      nextUnits[existingIndex] = mergeUnitSnapshot(existingUnit, event.unit);
      return {
        ...current,
        units: nextUnits,
      };
    }
    case "runtime:unit-log": {
      const existingIndex = current.units.findIndex(
        (unit) => unit.id === event.unitId,
      );

      if (existingIndex === -1) {
        return current;
      }

      const target = current.units[existingIndex];
      if (!target) {
        return current;
      }
      if (target.logTail.some((entry) => entry.id === event.entry.id)) {
        return current;
      }

      const nextUnits = [...current.units];
      nextUnits[existingIndex] = {
        ...target,
        logTail: [...target.logTail, event.entry].slice(-200),
      };

      return {
        ...current,
        units: nextUnits,
      };
    }
  }
}

function SurfaceButton({
  active,
  disabled,
  label,
  meta,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  meta: string;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "desktop-nav-item is-active" : "desktop-nav-item"}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <small>{meta}</small>
    </button>
  );
}

function SummaryCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function getWebviewPreloadUrl(): string {
  return new URL(
    "../dist-electron/preload/webview-preload.js",
    document.location.href,
  ).href;
}

// SurfaceFrame is imported from the shared component — see components/surface-frame.tsx

function RuntimeUnitCard({
  unit,
  onStart,
  onStop,
  busy,
}: {
  unit: RuntimeUnitState;
  onStart: (id: RuntimeUnitId) => Promise<void>;
  onStop: (id: RuntimeUnitId) => Promise<void>;
  busy: boolean;
}) {
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const isManaged =
    unit.launchStrategy === "managed" || unit.launchStrategy === "launchd";
  const canStart =
    isManaged &&
    (unit.phase === "idle" ||
      unit.phase === "stopped" ||
      unit.phase === "failed");
  const canStop =
    isManaged && (unit.phase === "running" || unit.phase === "starting");

  async function handleCopyLogs(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        filteredLogTail.map((entry) => formatLogLine(entry)).join("\n"),
      );
      toast.success(`Copied recent logs for ${unit.label}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to copy runtime logs.",
      );
    }
  }

  async function handleExportLogs(): Promise<void> {
    try {
      const ok = await showRuntimeLogFile(unit.id);

      if (!ok) {
        toast.error(`No log file available for ${unit.label}.`);
        return;
      }

      toast.success(`Revealed log file for ${unit.label}.`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to open runtime log file.",
      );
    }
  }

  const filteredLogTail = useMemo(() => {
    switch (logFilter) {
      case "errors":
        return unit.logTail.filter((entry) => entry.stream === "stderr");
      case "lifecycle":
        return unit.logTail.filter((entry) => entry.kind === "lifecycle");
      default:
        return unit.logTail;
    }
  }, [logFilter, unit.logTail]);

  return (
    <article className="runtime-card">
      <div className="runtime-card-head">
        <div>
          <div className="runtime-label-row">
            <strong>{unit.label}</strong>
            <span className={`runtime-badge ${phaseTone(unit.phase)}`}>
              {unit.phase}
            </span>
          </div>
          <p className="runtime-kind">{kindLabel(unit)}</p>
          <p className="runtime-command">
            {unit.commandSummary ?? "embedded runtime unit"}
          </p>
        </div>
        <div className="runtime-actions">
          <button
            disabled={!canStart || busy}
            onClick={() => void onStart(unit.id)}
            type="button"
          >
            Start
          </button>
          <button
            disabled={!canStop || busy}
            onClick={() => void onStop(unit.id)}
            type="button"
          >
            Stop
          </button>
        </div>
      </div>

      <dl className="runtime-grid">
        <div>
          <dt>PID</dt>
          <dd>{unit.pid ?? "-"}</dd>
        </div>
        <div>
          <dt>Port</dt>
          <dd>{unit.port ?? "-"}</dd>
        </div>
        <div>
          <dt>Auto start</dt>
          <dd>{unit.autoStart ? "yes" : "no"}</dd>
        </div>
        <div>
          <dt>Exit code</dt>
          <dd>{unit.exitCode ?? "-"}</dd>
        </div>
        <div>
          <dt>Last reason</dt>
          <dd>{unit.lastReasonCode ?? "-"}</dd>
        </div>
        <div>
          <dt>Restarts</dt>
          <dd>{unit.restartCount}</dd>
        </div>
        <div>
          <dt>Last probe</dt>
          <dd>{unit.lastProbeAt ?? "-"}</dd>
        </div>
      </dl>

      {unit.lastError ? (
        <p className="runtime-error">{unit.lastError}</p>
      ) : null}

      {unit.binaryPath ? (
        <div className="runtime-binary-path">
          <div className="runtime-logs-head">
            <strong>OPENCLAW_BIN</strong>
          </div>
          <code>{unit.binaryPath}</code>
        </div>
      ) : null}

      <div className="runtime-logs">
        <div className="runtime-logs-head">
          <strong>Tail 200 logs</strong>
          <div className="runtime-logs-actions">
            <span>{filteredLogTail.length} lines</span>
            {(["all", "errors", "lifecycle"] as const).map((filter) => (
              <button
                aria-pressed={logFilter === filter}
                key={filter}
                onClick={() => setLogFilter(filter)}
                type="button"
              >
                {logFilterLabel(filter)}
              </button>
            ))}
            <button onClick={() => void handleCopyLogs()} type="button">
              Copy
            </button>
            <button onClick={() => void handleExportLogs()} type="button">
              Reveal
            </button>
          </div>
        </div>
        <pre className="runtime-log-tail">
          {filteredLogTail.length > 0
            ? filteredLogTail.map((entry) => formatLogLine(entry)).join("\n")
            : "No logs yet."}
        </pre>
      </div>
    </article>
  );
}

type ComponentUpdateInfo = {
  id: string;
  currentVersion: string | null;
  newVersion: string;
  size: number;
};

function RuntimePage() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeUnitId, setActiveUnitId] = useState<RuntimeUnitId | null>(null);
  const [componentUpdates, setComponentUpdates] = useState<
    ComponentUpdateInfo[] | null
  >(null);
  const [componentBusy, setComponentBusy] = useState(false);
  const [componentMessage, setComponentMessage] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    try {
      const nextState = await getRuntimeState();
      setRuntimeState(nextState);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to load runtime state.",
      );
    }
  }, []);

  useEffect(() => {
    void loadState();
    const unsubscribe = onRuntimeEvent((event) => {
      setRuntimeState((current) => {
        if (!current) {
          return current;
        }

        return applyRuntimeEvent(current, event);
      });
      setErrorMessage(null);
    });

    const timer = window.setInterval(() => {
      void loadState();
    }, 15000);

    return () => {
      unsubscribe();
      window.clearInterval(timer);
    };
  }, [loadState]);

  const summary = useMemo(() => {
    const units = runtimeState?.units ?? [];
    return {
      running: units.filter((unit) => unit.phase === "running").length,
      failed: units.filter((unit) => unit.phase === "failed").length,
      managed: units.filter(
        (unit) =>
          unit.launchStrategy === "managed" ||
          unit.launchStrategy === "launchd",
      ).length,
    };
  }, [runtimeState]);

  const units = runtimeState?.units ?? [];

  useEffect(() => {
    if (units.length === 0) {
      setActiveUnitId(null);
      return;
    }

    if (!activeUnitId || !units.some((unit) => unit.id === activeUnitId)) {
      setActiveUnitId(units[0]?.id ?? null);
    }
  }, [activeUnitId, units]);

  const activeUnit =
    units.find((unit) => unit.id === activeUnitId) ?? units[0] ?? null;

  async function runAction(id: string, action: () => Promise<RuntimeState>) {
    setBusyId(id);
    try {
      const nextState = await action();
      setRuntimeState(nextState);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Runtime action failed.",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="runtime-page">
      <header className="runtime-header">
        <div>
          <span className="runtime-eyebrow">Desktop Runtime</span>
          <h1>nexu local cold-start control room</h1>
          <p>
            Renderer keeps the browser mental model. Electron main orchestrates
            local runtime units.
          </p>
        </div>
      </header>

      <section className="runtime-summary">
        <SummaryCard
          label="Started at"
          value={runtimeState?.startedAt ?? "-"}
        />
        <SummaryCard label="Running" value={summary.running} />
        <SummaryCard label="Managed" value={summary.managed} />
        <SummaryCard label="Failed" value={summary.failed} />
      </section>

      <section className="component-update-section">
        <div className="component-update-head">
          <strong>Component Updates</strong>
          <button
            disabled={componentBusy}
            onClick={() => {
              setComponentBusy(true);
              setComponentMessage(null);
              void checkComponentUpdates()
                .then((result) => {
                  setComponentUpdates(result.updates);
                  setComponentMessage(
                    result.updates.length === 0
                      ? "All components are up to date."
                      : `${result.updates.length} update(s) available.`,
                  );
                })
                .catch((error) => {
                  setComponentMessage(
                    error instanceof Error
                      ? error.message
                      : "Failed to check component updates.",
                  );
                })
                .finally(() => setComponentBusy(false));
            }}
            type="button"
          >
            {componentBusy ? "Checking..." : "Check"}
          </button>
        </div>
        {componentMessage ? (
          <p className="component-update-message">{componentMessage}</p>
        ) : null}
        {componentUpdates && componentUpdates.length > 0 ? (
          <ul className="component-update-list">
            {componentUpdates.map((u) => (
              <li key={u.id}>
                <span>
                  {u.id}: {u.currentVersion ?? "none"} → {u.newVersion} (
                  {u.size} bytes)
                </span>
                <button
                  disabled={componentBusy}
                  onClick={() => {
                    setComponentBusy(true);
                    void installComponent(u.id)
                      .then((result) => {
                        setComponentMessage(
                          result.ok
                            ? `Installed ${u.id} successfully.`
                            : `Failed to install ${u.id}.`,
                        );
                        if (result.ok) {
                          setComponentUpdates(
                            (prev) =>
                              prev?.filter((item) => item.id !== u.id) ?? null,
                          );
                        }
                      })
                      .catch((error) => {
                        setComponentMessage(
                          error instanceof Error
                            ? error.message
                            : `Install failed for ${u.id}.`,
                        );
                      })
                      .finally(() => setComponentBusy(false));
                  }}
                  type="button"
                >
                  Install
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <p className="runtime-note">
        Control plane currently renders unit metadata plus in-memory tail 200
        logs from the local orchestrator.
      </p>

      {errorMessage ? (
        <p className="runtime-error-banner">{errorMessage}</p>
      ) : null}

      <section className="runtime-pane-layout">
        <aside className="runtime-sidebar" aria-label="Runtime units">
          {units.map((unit) => (
            <button
              aria-selected={activeUnit?.id === unit.id}
              className={
                activeUnit?.id === unit.id
                  ? "runtime-side-tab is-active"
                  : "runtime-side-tab"
              }
              key={unit.id}
              onClick={() => setActiveUnitId(unit.id)}
              role="tab"
              type="button"
            >
              <span className="runtime-side-tab-label">{unit.label}</span>
              <span className={`runtime-badge ${phaseTone(unit.phase)}`}>
                {unit.phase}
              </span>
            </button>
          ))}
        </aside>

        <div className="runtime-detail-pane">
          {activeUnit ? (
            <RuntimeUnitCard
              busy={busyId !== null}
              onStart={(id) => runAction(`start:${id}`, () => startUnit(id))}
              onStop={(id) => runAction(`stop:${id}`, () => stopUnit(id))}
              unit={activeUnit}
            />
          ) : (
            <section className="runtime-empty-state">
              No runtime units available.
            </section>
          )}
        </div>
      </section>
    </div>
  );
}

function EmbeddedControlPlane() {
  return (
    <>
      <RuntimePage />
      <Toaster position="top-right" />
    </>
  );
}

type DiagnosticsActionId =
  | "renderer-exception"
  | "renderer-crash"
  | "main-crash";

function DiagnosticsActionCard({
  description,
  disabled,
  label,
  onClick,
}: {
  description: string;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <article className="diagnostics-action-card">
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button disabled={disabled} onClick={onClick} type="button">
        Trigger
      </button>
    </article>
  );
}

function DiagnosticsPage({
  runtimeConfig,
}: {
  runtimeConfig: DesktopRuntimeConfig | null;
}) {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [diagnosticsInfo, setDiagnosticsInfo] =
    useState<DiagnosticsInfo | null>(null);
  const [busyAction, setBusyAction] = useState<DiagnosticsActionId | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string>(
    "Ready for diagnostics.",
  );

  useEffect(() => {
    void Promise.all([getAppInfo(), getDiagnosticsInfo()])
      .then(([nextAppInfo, nextDiagnosticsInfo]) => {
        setAppInfo(nextAppInfo);
        setDiagnosticsInfo(nextDiagnosticsInfo);
        setErrorMessage(null);
      })
      .catch((error) => {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to load diagnostics metadata.",
        );
      });
  }, []);

  const runAction = useCallback(
    async (actionId: DiagnosticsActionId, action: () => Promise<void>) => {
      setBusyAction(actionId);
      setErrorMessage(null);

      try {
        await action();
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "Diagnostics action failed.",
        );
      } finally {
        setBusyAction(null);
      }
    },
    [],
  );

  const triggerRendererException = useCallback(() => {
    const title = "desktop.renderer.exception";
    setLastAction(
      `Renderer exception scheduled at ${new Date().toLocaleTimeString()}.`,
    );

    window.setTimeout(() => {
      throw new Error(title);
    }, 0);
  }, []);

  const triggerRendererCrash = useCallback(() => {
    setLastAction(
      `Renderer crash requested at ${new Date().toLocaleTimeString()}.`,
    );

    void runAction("renderer-crash", async () => {
      await triggerRendererProcessCrash();
    });
  }, [runAction]);

  const triggerMainCrash = useCallback(() => {
    setLastAction(
      `Main crash requested at ${new Date().toLocaleTimeString()}.`,
    );

    void runAction("main-crash", async () => {
      await triggerMainProcessCrash();
    });
  }, [runAction]);

  return (
    <div className="runtime-page diagnostics-page">
      <header className="runtime-header diagnostics-header">
        <div>
          <span className="runtime-eyebrow">Crash Diagnostics</span>
          <h1>Exercise the Electron failure paths on demand</h1>
          <p>
            Use one page to validate renderer exceptions, renderer process
            exits, and main process crashes through the local desktop
            observability stack.
          </p>
        </div>
      </header>

      <section className="runtime-summary diagnostics-summary">
        <SummaryCard
          label="App"
          value={appInfo ? `${appInfo.appName} ${appInfo.appVersion}` : "-"}
        />
        <SummaryCard label="Platform" value={appInfo?.platform ?? "-"} />
        <SummaryCard
          label="Mode"
          value={appInfo ? (appInfo.isDev ? "development" : "packaged") : "-"}
        />
        <SummaryCard
          label="Native crashes"
          value={
            diagnosticsInfo
              ? diagnosticsInfo.nativeCrashPipeline === "sentry"
                ? "sentry"
                : "local-only"
              : "-"
          }
        />
        <SummaryCard
          label="nexu Home"
          className="diagnostics-summary-wide"
          value={runtimeConfig?.paths.nexuHome ?? "-"}
        />
        <SummaryCard
          label="Crash dumps"
          className="diagnostics-summary-wide"
          value={diagnosticsInfo?.crashDumpsPath ?? "-"}
        />
        <SummaryCard
          label="Sentry DSN"
          className="diagnostics-summary-wide"
          value={
            diagnosticsInfo ? maskSentryDsn(diagnosticsInfo.sentryDsn) : "-"
          }
        />
      </section>

      <p className="runtime-note diagnostics-note">
        The renderer exception path keeps the process alive and is meant for
        JavaScript error capture. The renderer crash and main crash paths
        terminate a process and are meant for native crash capture.
      </p>

      {errorMessage ? (
        <p className="runtime-error-banner">{errorMessage}</p>
      ) : null}

      <section className="diagnostics-grid">
        <DiagnosticsActionCard
          description="Throws an unhandled renderer Error named desktop.renderer.exception. Use this to validate JavaScript exception capture without killing the app."
          disabled={busyAction !== null}
          label="Test Renderer Exception"
          onClick={triggerRendererException}
        />
        <DiagnosticsActionCard
          description="Asks the main process to forcefully crash the current renderer process with the title desktop.renderer.crash. Use this to validate renderer crash handling and crash dump creation."
          disabled={busyAction !== null}
          label="Test Renderer Crash"
          onClick={triggerRendererCrash}
        />
        <DiagnosticsActionCard
          description="Invokes a deliberate main process crash with the title desktop.main.crash. Use this to validate the native crash pipeline for the Electron host itself."
          disabled={busyAction !== null}
          label="Test Main Crash"
          onClick={triggerMainCrash}
        />
      </section>

      <section className="diagnostics-status-card">
        <div>
          <span className="runtime-eyebrow">Last action</span>
          <h2>{lastAction}</h2>
          <p>
            Renderer process type: {diagnosticsInfo?.processType ?? "unknown"}.
            JavaScript exceptions should stay visible in the renderer and in
            Sentry when configured. Process crashes should leave Crashpad dumps
            and, with Sentry enabled, upload native crash events.
          </p>
        </div>
      </section>
    </div>
  );
}

function DesktopShell() {
  const isPackaged = window.nexuHost.bootstrap.isPackaged;
  const [activeSurface, setActiveSurface] = useState<DesktopSurface>("web");
  const [chromeMode, setChromeMode] = useState<DesktopChromeMode>(
    isPackaged ? "immersive" : "full",
  );
  const webSurfaceVersion = 0;
  const [runtimeConfig, setRuntimeConfig] =
    useState<DesktopRuntimeConfig | null>(null);
  const update = useAutoUpdate();
  useEffect(() => {
    void getRuntimeConfig()
      .then(setRuntimeConfig)
      .catch(() => null);
  }, []);

  useEffect(() => {
    return onDesktopCommand((command) => {
      if (command.type === "desktop:check-for-updates") {
        void update.check();
        return;
      }

      setActiveSurface(command.surface);
      setChromeMode(command.chromeMode);
    });
  }, [update]);

  // Poll the controller ready endpoint through the web sidecar proxy before mounting the webview.
  // Note: getRuntimeConfig() IPC handler waits for cold-start to complete, so
  // runtimeConfig always has the final ports (including any fallback).
  const [controllerReady, setControllerReady] = useState(false);

  useEffect(() => {
    if (!runtimeConfig) return;
    if (controllerReady) return;

    let cancelled = false;
    const readyUrl = new URL(
      "/api/internal/desktop/ready",
      runtimeConfig.urls.web,
    ).toString();

    async function poll() {
      while (!cancelled) {
        try {
          const res = await fetch(readyUrl, {
            signal: AbortSignal.timeout(3000),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.ready) {
              if (!cancelled) setControllerReady(true);
              return;
            }
          }
        } catch {
          // Controller or web sidecar not ready yet — keep polling
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, [runtimeConfig, controllerReady]);

  const desktopWebUrl =
    runtimeConfig && controllerReady
      ? new URL("/workspace", runtimeConfig.urls.web).toString()
      : null;
  const desktopOpenClawUrl = runtimeConfig
    ? new URL(
        `/#token=${runtimeConfig.tokens.gateway}`,
        runtimeConfig.urls.openclawBase,
      ).toString()
    : null;
  return (
    <div
      className={
        chromeMode === "immersive"
          ? "desktop-shell is-immersive"
          : "desktop-shell"
      }
    >
      <div className="window-drag-bar" />
      <aside className="desktop-sidebar">
        <div className="desktop-sidebar-brand">
          <span className="desktop-shell-eyebrow">nexu desktop</span>
          <h1>Runtime Console</h1>
          <p>
            One local shell for bootstrap health, web verification, and gateway
            inspection.
          </p>
        </div>

        <nav className="desktop-nav" aria-label="Desktop surfaces">
          <SurfaceButton
            active={activeSurface === "control"}
            label="Control Plane"
            meta="Bootstrap status and per-unit intervention"
            onClick={() => setActiveSurface("control")}
          />
          <SurfaceButton
            active={activeSurface === "cloud-profile"}
            label="Cloud Profile"
            meta="Switch cloud endpoints and reset auth state"
            onClick={() => setActiveSurface("cloud-profile")}
          />
          <SurfaceButton
            active={activeSurface === "web"}
            disabled={!desktopWebUrl}
            label="Web"
            meta="Workspace surface via local HTTP sidecar"
            onClick={() => setActiveSurface("web")}
          />
          <SurfaceButton
            active={activeSurface === "openclaw"}
            label="OpenClaw"
            meta="Gateway control UI with local token routing"
            onClick={() => setActiveSurface("openclaw")}
          />
          <SurfaceButton
            active={activeSurface === "diagnostics"}
            label="Diagnostics"
            meta="Crash and exception test bench"
            onClick={() => setActiveSurface("diagnostics")}
          />
        </nav>

        {runtimeConfig ? (
          <div className="desktop-sidebar-config">
            <span className="desktop-shell-eyebrow">Build Info</span>
            <dl className="desktop-config-list">
              <div>
                <dt>Source</dt>
                <dd>{runtimeConfig.buildInfo.source}</dd>
              </div>
              <div>
                <dt>Version</dt>
                <dd>{runtimeConfig.buildInfo.version}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{runtimeConfig.buildInfo.branch ?? "(unknown)"}</dd>
              </div>
              <div>
                <dt>Commit</dt>
                <dd title={runtimeConfig.buildInfo.commit ?? undefined}>
                  {formatBuildCommit(runtimeConfig.buildInfo.commit)}
                </dd>
              </div>
              <div>
                <dt>Built At</dt>
                <dd>{formatBuildTimestamp(runtimeConfig.buildInfo.builtAt)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
      </aside>

      <main className="desktop-shell-stage">
        <div
          style={{ display: activeSurface === "control" ? "contents" : "none" }}
        >
          <EmbeddedControlPlane />
        </div>
        <div
          style={{
            display: activeSurface === "cloud-profile" ? "contents" : "none",
          }}
        >
          <CloudProfilePage />
        </div>
        <div style={{ display: activeSurface === "web" ? "contents" : "none" }}>
          <SurfaceFrame
            description="Authenticated workspace surface served by the repo-local web sidecar."
            src={desktopWebUrl}
            title="nexu Web"
            version={webSurfaceVersion}
            preload={getWebviewPreloadUrl()}
          />
        </div>
        <div
          style={{
            display: activeSurface === "openclaw" ? "contents" : "none",
          }}
        >
          <SurfaceFrame
            description="Local OpenClaw gateway UI for inspecting runtime auth, models, and sessions."
            src={desktopOpenClawUrl}
            title="OpenClaw Gateway"
            version={0}
          />
        </div>
        <div
          style={{
            display: activeSurface === "diagnostics" ? "contents" : "none",
          }}
        >
          <DiagnosticsPage runtimeConfig={runtimeConfig} />
        </div>
      </main>

      <UpdateBanner
        dismissed={update.dismissed}
        errorMessage={update.errorMessage}
        onDismiss={update.dismiss}
        onDownload={() => void update.download()}
        onInstall={() => void update.install()}
        percent={update.percent}
        phase={update.phase}
        version={update.version}
      />
    </div>
  );
}

function RootApp() {
  return <DesktopShell />;
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RootApp />
    </QueryClientProvider>
  </React.StrictMode>,
);
