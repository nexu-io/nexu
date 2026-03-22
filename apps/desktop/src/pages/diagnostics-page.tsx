import { useCallback, useEffect, useState } from "react";
import type { AppInfo, DiagnosticsInfo } from "../../shared/host";
import { DiagnosticsActionCard } from "../components/diagnostics-action-card";
import { SummaryCard } from "../components/summary-card";
import { useDesktopRuntimeConfig } from "../hooks/use-desktop-runtime-config";
import {
  getAppInfo,
  getDiagnosticsInfo,
  triggerMainProcessCrash,
  triggerRendererProcessCrash,
} from "../lib/host-api";
import { maskSentryDsn } from "../lib/runtime-formatters";

type DiagnosticsActionId =
  | "renderer-exception"
  | "renderer-crash"
  | "main-crash";

export function DiagnosticsPage() {
  const { runtimeConfig } = useDesktopRuntimeConfig();
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
          label="NEXU_HOME"
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
