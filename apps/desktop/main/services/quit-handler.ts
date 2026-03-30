/**
 * Quit Handler - Desktop exit behavior with launchd services
 *
 * Window close (red traffic light) → hide to background, services keep running.
 * Cmd+Q / Dock Quit → full teardown and exit.
 */

import { BrowserWindow, app } from "electron";
import type { EmbeddedWebServer } from "./embedded-web-server";
import { teardownLaunchdServices } from "./launchd-bootstrap";
import type { LaunchdManager } from "./launchd-manager";

export interface QuitHandlerOptions {
  launchd: LaunchdManager;
  labels: {
    controller: string;
    openclaw: string;
  };
  webServer?: EmbeddedWebServer;
  /** Plist directory for runtime-ports.json cleanup */
  plistDir?: string;
  /** Called before quitting to flush logs, etc */
  onBeforeQuit?: () => void | Promise<void>;
  /** Called to signal that the app should actually close windows on quit */
  onForceQuit?: () => void;
}

export type QuitDecision = "quit-completely" | "run-in-background" | "cancel";

/**
 * Install quit handler for launchd-managed services.
 *
 * Uses the window "close" event (synchronous) as the entry point instead of
 * "before-quit" (which doesn't reliably support async operations in Electron).
 */
/**
 * Shared teardown sequence: flush logs, close web server, stop launchd
 * services, then force-exit. Used by all quit paths (dev close, dev Cmd+Q,
 * packaged quit-completely, packaged no-window). Extracted to avoid the
 * "changed two of three" drift bug.
 *
 * Always ends with `app.exit(0)` in `finally`, so even if teardown throws,
 * the app won't hang.
 */
async function runTeardownAndExit(
  opts: QuitHandlerOptions,
  logLabel: string,
): Promise<void> {
  try {
    try {
      await opts.onBeforeQuit?.();
    } catch (err) {
      console.warn(`[${logLabel}] onBeforeQuit failed:`, err);
    }
    try {
      await opts.webServer?.close();
    } catch (err) {
      console.warn(`[${logLabel}] webServer.close failed:`, err);
    }
    await teardownLaunchdServices({
      launchd: opts.launchd,
      labels: opts.labels,
      plistDir: opts.plistDir ?? "",
    });
  } catch (err) {
    console.error(`[${logLabel}] teardown failed:`, err);
  } finally {
    (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
    app.exit(0);
  }
}

export function installLaunchdQuitHandler(opts: QuitHandlerOptions): void {
  // Intercept main window close — hide to background (no dialog)
  const interceptWindowClose = (window: BrowserWindow) => {
    window.on("close", (event) => {
      // If a force-quit is in progress, let the window close
      if ((app as unknown as Record<string, unknown>).__nexuForceQuit) return;

      // Dev mode: teardown launchd services before letting the window close.
      // Without this, `pnpm start` -> close window -> `pnpm start` may have
      // stale launchd services still running and holding ports.
      if (!app.isPackaged) {
        event.preventDefault();
        void runTeardownAndExit(opts, "dev-close");
        return;
      }

      // Window close (red traffic light) → hide to background.
      // Services keep running so bots stay online.
      // "Quit Completely" is only triggered via Cmd+Q / Dock Quit.
      event.preventDefault();
      window.hide();
    });
  };

  // Apply to the main window only (avoid duplicate handlers)
  const mainWin = BrowserWindow.getAllWindows()[0];
  if (mainWin) {
    interceptWindowClose(mainWin);
  }

  // Intercept Cmd+Q / Dock "Quit" — ensure teardown in both dev and packaged.
  app.on("before-quit", (event) => {
    if ((app as unknown as Record<string, unknown>).__nexuForceQuit) return;

    // Dev mode: Cmd+Q / app.quit() must also teardown launchd services.
    if (!app.isPackaged) {
      event.preventDefault();
      void runTeardownAndExit(opts, "dev-before-quit");
      return;
    }

    // Packaged Cmd+Q / Dock Quit → full teardown and exit.
    event.preventDefault();
    opts.onForceQuit?.();
    void runTeardownAndExit(opts, "packaged-quit");
  });
}

/**
 * Programmatically quit with a specific decision (for testing or automation).
 */
export async function quitWithDecision(
  decision: "quit-completely" | "run-in-background",
  opts: QuitHandlerOptions,
): Promise<void> {
  try {
    await opts.onBeforeQuit?.();
  } catch (err) {
    console.error("Error in onBeforeQuit:", err);
  }

  try {
    await opts.webServer?.close();
  } catch (err) {
    console.error("Error closing web server:", err);
  }

  if (decision === "quit-completely") {
    await teardownLaunchdServices({
      launchd: opts.launchd,
      labels: opts.labels,
      plistDir: opts.plistDir ?? "",
    });

    (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
    app.exit(0);
    return;
  }

  // run-in-background: hide window, keep services running
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.hide();
}
