import * as amplitude from "@amplitude/unified";
import { Identify } from "@amplitude/unified";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Toaster } from "sonner";
import type {
  DesktopRuntimeConfig,
  RuntimeState,
  RuntimeUnitId,
  RuntimeUnitPhase,
  RuntimeUnitState,
} from "../shared/host";
import {
  getApiBaseUrl,
  getRuntimeConfig,
  getRuntimeState,
  openExternal,
  startAllUnits,
  startUnit,
  stopAllUnits,
  stopUnit,
} from "./lib/host-api";
import "./runtime-page.css";

const amplitudeApiKey = import.meta.env.VITE_AMPLITUDE_API_KEY;

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

interface CloudStatus {
  connected: boolean;
  polling: boolean;
  userName: string | null;
  userEmail: string | null;
  connectedAt: string | null;
}

function CloudConnectionCard() {
  const [apiBase, setApiBase] = useState<string | null>(null);
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getApiBaseUrl().then(setApiBase).catch(() => null);
  }, []);

  const fetchStatus = useCallback(async () => {
    if (!apiBase) return;
    try {
      const res = await fetch(`${apiBase}/api/internal/desktop/cloud-status`);
      const data = (await res.json()) as CloudStatus;
      setStatus(data);
      setError(null);
    } catch {
      // API not ready yet
    }
  }, [apiBase]);

  useEffect(() => {
    void fetchStatus();
    const timer = window.setInterval(() => void fetchStatus(), 3000);
    return () => window.clearInterval(timer);
  }, [fetchStatus]);

  const handleConnect = async () => {
    if (!apiBase) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/api/internal/desktop/cloud-connect`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? "Failed to initiate connection");
        setBusy(false);
        return;
      }
      const data = (await res.json()) as { browserUrl: string };
      await openExternal(data.browserUrl);
      setBusy(false);
      // Polling state will be picked up by fetchStatus
    } catch {
      setError("Failed to connect");
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    if (!apiBase) return;
    setBusy(true);
    setError(null);
    try {
      await fetch(`${apiBase}/api/internal/desktop/cloud-disconnect`, {
        method: "POST",
      });
      await fetchStatus();
    } catch {
      setError("Failed to disconnect");
    }
    setBusy(false);
  };

  const isConnected = status?.connected ?? false;
  const isPolling = status?.polling ?? false;

  return (
    <article className="cloud-card">
      <div className="cloud-card-head">
        <div>
          <div className="runtime-label-row">
            <strong>Cloud Connection</strong>
            <span
              className={`runtime-badge ${isConnected ? "is-running" : isPolling ? "is-busy" : "is-idle"}`}
            >
              {isConnected
                ? "connected"
                : isPolling
                  ? "waiting..."
                  : "disconnected"}
            </span>
          </div>
          {isConnected && status?.userEmail && (
            <p className="cloud-user-info">
              {status.userName ? `${status.userName} · ` : ""}
              {status.userEmail}
            </p>
          )}
          {isPolling && (
            <p className="cloud-user-info">
              Waiting for browser login... Check your browser.
            </p>
          )}
        </div>
        <div className="runtime-actions">
          {isConnected ? (
            <button
              disabled={busy}
              onClick={() => void handleDisconnect()}
              type="button"
              className="cloud-disconnect-btn"
            >
              Disconnect
            </button>
          ) : (
            <button
              disabled={busy || isPolling}
              onClick={() => void handleConnect()}
              type="button"
            >
              {isPolling ? "Waiting..." : "Connect"}
            </button>
          )}
        </div>
      </div>
      {error && <p className="runtime-error">{error}</p>}
    </article>
  );
}

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
  const isManaged = unit.launchStrategy === "managed";
  const canStart =
    isManaged &&
    (unit.phase === "idle" ||
      unit.phase === "stopped" ||
      unit.phase === "failed");
  const canStop =
    isManaged && (unit.phase === "running" || unit.phase === "starting");

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
      </dl>

      {unit.lastError ? (
        <p className="runtime-error">{unit.lastError}</p>
      ) : null}

      <div className="runtime-logs">
        <div className="runtime-logs-head">
          <strong>Tail 200 logs</strong>
          <span>{unit.logTail.length} lines</span>
        </div>
        <pre className="runtime-log-tail">
          {unit.logTail.length > 0 ? unit.logTail.join("\n") : "No logs yet."}
        </pre>
      </div>
    </article>
  );
}

function RuntimePage() {
  const [runtimeState, setRuntimeState] = useState<RuntimeState | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeUnitId, setActiveUnitId] = useState<RuntimeUnitId | null>(null);

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
    const timer = window.setInterval(() => {
      void loadState();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };
  }, [loadState]);

  const summary = useMemo(() => {
    const units = runtimeState?.units ?? [];
    return {
      running: units.filter((unit) => unit.phase === "running").length,
      failed: units.filter((unit) => unit.phase === "failed").length,
      managed: units.filter((unit) => unit.launchStrategy === "managed").length,
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
          <h1>Nexu local cold-start control room</h1>
          <p>
            Renderer keeps the browser mental model. Electron main orchestrates
            local runtime units.
          </p>
        </div>
        <div className="runtime-header-actions">
          <button
            disabled={busyId !== null}
            onClick={() => void runAction("all:start", startAllUnits)}
            type="button"
          >
            Start all
          </button>
          <button
            disabled={busyId !== null}
            onClick={() => void runAction("all:stop", stopAllUnits)}
            type="button"
          >
            Stop all
          </button>
        </div>
      </header>

      <section className="runtime-summary">
        <div>
          <dt>Started at</dt>
          <dd>{runtimeState?.startedAt ?? "-"}</dd>
        </div>
        <div>
          <dt>Running</dt>
          <dd>{summary.running}</dd>
        </div>
        <div>
          <dt>Managed</dt>
          <dd>{summary.managed}</dd>
        </div>
        <div>
          <dt>Failed</dt>
          <dd>{summary.failed}</dd>
        </div>
      </section>

      <section className="cloud-section">
        <CloudConnectionCard />
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

function DesktopShell() {
  const [activeSurface, setActiveSurface] = useState<
    "web" | "session-chat" | "control"
  >("control");
  const [runtimeConfig, setRuntimeConfig] =
    useState<DesktopRuntimeConfig | null>(null);

  useEffect(() => {
    void getRuntimeConfig()
      .then(setRuntimeConfig)
      .catch(() => null);
  }, []);

  const desktopWebUrl = runtimeConfig
    ? new URL("/workspace", runtimeConfig.webUrl).toString()
    : null;
  const desktopSessionChatUrl = runtimeConfig?.sessionChatUrl ?? null;

  return (
    <div className="desktop-shell">
      <aside className="desktop-sidebar">
        <div className="desktop-sidebar-brand">
          <span className="desktop-shell-eyebrow">nexu desktop</span>
          <h1>Runtime Console</h1>
        </div>

        <nav className="desktop-nav" aria-label="Desktop surfaces">
          <button
            className={
              activeSurface === "web"
                ? "desktop-nav-item is-active"
                : "desktop-nav-item"
            }
            onClick={() => setActiveSurface("web")}
            type="button"
          >
            <span>Web</span>
            <small>HTTP sidecar</small>
          </button>
          <button
            className={
              activeSurface === "session-chat"
                ? "desktop-nav-item is-active"
                : "desktop-nav-item"
            }
            onClick={() => setActiveSurface("session-chat")}
            type="button"
          >
            <span>Session Chat</span>
            <small>Next.js sidecar</small>
          </button>
          <button
            className={
              activeSurface === "control"
                ? "desktop-nav-item is-active"
                : "desktop-nav-item"
            }
            onClick={() => setActiveSurface("control")}
            type="button"
          >
            <span>Control Plane</span>
            <small>Local operator UI</small>
          </button>
        </nav>
      </aside>

      <main className="desktop-shell-stage">
        {activeSurface === "web" && desktopWebUrl ? (
          <webview className="desktop-web-frame" src={desktopWebUrl} />
        ) : activeSurface === "session-chat" && desktopSessionChatUrl ? (
          <webview className="desktop-web-frame" src={desktopSessionChatUrl} />
        ) : (
          <EmbeddedControlPlane />
        )}
      </main>
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
