import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import type { DesktopChromeMode, DesktopSurface } from "../../shared/host";
import { useAutoUpdate } from "../hooks/use-auto-update";
import { useDesktopRuntimeConfig } from "../hooks/use-desktop-runtime-config";
import { onDesktopCommand } from "../lib/host-api";
import {
  formatBuildCommit,
  formatBuildTimestamp,
} from "../lib/runtime-formatters";
import { DiagnosticsPage } from "../pages/diagnostics-page";
import { RuntimePage } from "../pages/runtime-page";
import { DevelopSetBalanceDialog } from "./develop-set-balance-dialog";
import { SurfaceButton } from "./surface-button";
import { SurfaceFrame } from "./surface-frame";
import { UpdateBanner } from "./update-banner";

function getWebviewPreloadUrl(): string {
  return window.nexuHost.bootstrap.webviewPreloadUrl;
}

export function DesktopShell() {
  const isPackaged = window.nexuHost.bootstrap.isPackaged;
  const [activeSurface, setActiveSurface] = useState<DesktopSurface>(
    isPackaged ? "web" : "control",
  );
  const [showSetBalanceDialog, setShowSetBalanceDialog] = useState(false);
  const [chromeMode, setChromeMode] = useState<DesktopChromeMode>(
    isPackaged ? "immersive" : "full",
  );
  const webSurfaceVersion = 0;
  const { desktopOpenClawUrl, desktopWebUrl, runtimeConfig } =
    useDesktopRuntimeConfig();
  const update = useAutoUpdate();
  const { check: checkForUpdates } = update;

  useEffect(() => {
    return onDesktopCommand((command) => {
      if (command.type === "desktop:check-for-updates") {
        void checkForUpdates();
        return;
      }
      if (command.type === "develop:open-set-balance") {
        setShowSetBalanceDialog(true);
        return;
      }
      if (command.type === "setup:complete") {
        return;
      }
      if (
        command.type !== "develop:focus-surface" &&
        command.type !== "develop:show-shell"
      ) {
        return;
      }

      setActiveSurface(command.surface);
      setChromeMode(command.chromeMode);
    });
  }, [checkForUpdates]);

  return (
    <div
      className={
        chromeMode === "immersive"
          ? "desktop-shell is-immersive"
          : "desktop-shell"
      }
    >
      <DevelopSetBalanceDialog
        open={showSetBalanceDialog}
        onClose={() => setShowSetBalanceDialog(false)}
      />
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
          <>
            <RuntimePage />
            <Toaster position="top-right" />
          </>
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
          <DiagnosticsPage />
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
