/**
 * Quit Handler - Desktop exit behavior with launchd services
 *
 * On macOS, window close is intercepted to show a quit dialog.
 * - Quit Completely: stop all launchd services and exit
 * - Run in Background: hide window, keep services running
 * - Cancel: do nothing
 */

import { BrowserWindow, app, dialog } from "electron";
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

const i18n = {
  en: {
    buttons: ["Quit Completely", "Run in Background", "Cancel"],
    title: "Quit Nexu",
    message: "Choose exit mode",
    detail:
      "Running in background keeps services running, bots continue working.\n\n" +
      "To fully stop services, choose 'Quit Completely'.",
  },
  zh: {
    buttons: ["完全退出", "后台运行", "取消"],
    title: "退出 Nexu",
    message: "选择退出方式",
    detail:
      "后台运行将保持服务运行，机器人继续工作。\n\n" +
      "如需完全停止服务，请选择「完全退出」。",
  },
} as const;

function getQuitDialogLocale(): {
  buttons: readonly string[];
  title: string;
  message: string;
  detail: string;
} {
  const locale = app.getLocale();
  return locale.startsWith("zh") ? i18n.zh : i18n.en;
}

async function showQuitDialog(): Promise<QuitDecision> {
  const t = getQuitDialogLocale();
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: [...t.buttons],
    defaultId: 0,
    title: t.title,
    message: t.message,
    detail: t.detail,
  });

  switch (response) {
    case 0:
      return "quit-completely";
    case 1:
      return "run-in-background";
    default:
      return "cancel";
  }
}

/**
 * Install quit handler for launchd-managed services.
 *
 * Uses the window "close" event (synchronous) as the entry point instead of
 * "before-quit" (which doesn't reliably support async operations in Electron).
 */
export function installLaunchdQuitHandler(opts: QuitHandlerOptions): void {
  let dialogOpen = false;

  // Intercept main window close to show quit dialog
  const interceptWindowClose = (window: BrowserWindow) => {
    window.on("close", (event) => {
      // If a force-quit is in progress, let the window close
      if ((app as unknown as Record<string, unknown>).__nexuForceQuit) return;

      // Dev mode: let the window close normally (no dialog, no hide).
      // Services are stopped by `pnpm stop` / dev-launchd.sh.
      if (!app.isPackaged) {
        return;
      }

      // Prevent close while dialog is showing
      if (dialogOpen) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      dialogOpen = true;

      void (async () => {
        const decision = await showQuitDialog();
        dialogOpen = false;

        if (decision === "cancel") {
          return;
        }

        if (decision === "run-in-background") {
          window.hide();
          return;
        }

        // "quit-completely"
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

        // Use the shared teardown sequence: bootout each service (with PID-based
        // SIGKILL fallback), delete runtime-ports.json, and kill orphan processes.
        // Always run teardown — plistDir is only used for runtime-ports cleanup;
        // the bootout + process kill sequence works without it.
        await teardownLaunchdServices({
          launchd: opts.launchd,
          labels: opts.labels,
          plistDir: opts.plistDir ?? "",
        });

        // All services stopped. Force exit immediately — app.quit() alone
        // can hang if dangling handles keep the event loop alive, and a
        // delayed exit leaves stale SingletonLock files that block relaunch.
        (app as unknown as Record<string, unknown>).__nexuForceQuit = true;
        opts.onForceQuit?.();
        app.exit(0);
      })();
    });
  };

  // Apply to the main window only (avoid duplicate handlers)
  const mainWin = BrowserWindow.getAllWindows()[0];
  if (mainWin) {
    interceptWindowClose(mainWin);
  }

  // Intercept Cmd+Q / Dock "Quit" — redirect to window close handler
  // which shows the quit dialog (packaged only).
  app.on("before-quit", (event) => {
    if ((app as unknown as Record<string, unknown>).__nexuForceQuit) return;
    // Dev mode: let quit proceed normally
    if (!app.isPackaged) return;
    // Packaged: prevent quit, show dialog via window close
    event.preventDefault();
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (!win.isVisible()) win.show();
      win.close();
    }
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
