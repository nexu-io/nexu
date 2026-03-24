/**
 * Quit Handler - Desktop exit behavior with launchd services
 *
 * Provides quit dialog with options:
 * - Quit Completely: stop all launchd services and exit
 * - Run in Background: close GUI, keep services running
 * - Cancel: don't quit
 */

import { app, dialog } from "electron";
import type { EmbeddedWebServer } from "./embedded-web-server";
import type { LaunchdManager } from "./launchd-manager";

export interface QuitHandlerOptions {
  launchd: LaunchdManager;
  labels: {
    controller: string;
    openclaw: string;
  };
  webServer?: EmbeddedWebServer;
  /** Called before quitting to flush logs, etc */
  onBeforeQuit?: () => void | Promise<void>;
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

/**
 * Show quit dialog and get user's choice.
 */
export async function showQuitDialog(): Promise<QuitDecision> {
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
 */
export function installLaunchdQuitHandler(opts: QuitHandlerOptions): void {
  let isQuitting = false;

  app.on("before-quit", async (event) => {
    // Prevent recursive handling
    if (isQuitting) {
      return;
    }

    event.preventDefault();

    // In dev mode, skip dialog and keep services running (vite HMR restarts
    // Electron frequently; stopping services each time would cause needless
    // downtime). The dev-launchd.sh stop/clean commands use SIGKILL to bypass
    // this handler when a full stop is intended.
    const decision: QuitDecision = app.isPackaged
      ? await showQuitDialog()
      : "run-in-background";

    if (decision === "cancel") {
      return;
    }

    isQuitting = true;

    // Run cleanup callback
    if (opts.onBeforeQuit) {
      try {
        await opts.onBeforeQuit();
      } catch (err) {
        console.error("Error in onBeforeQuit:", err);
      }
    }

    // Close web server if running
    if (opts.webServer) {
      try {
        await opts.webServer.close();
      } catch (err) {
        console.error("Error closing web server:", err);
      }
    }

    if (decision === "quit-completely") {
      // Stop all launchd services
      console.log("Stopping launchd services...");

      try {
        await opts.launchd.stopServiceGracefully(opts.labels.openclaw);
        console.log(`Stopped ${opts.labels.openclaw}`);
      } catch (err) {
        console.error(`Error stopping ${opts.labels.openclaw}:`, err);
      }

      try {
        await opts.launchd.stopServiceGracefully(opts.labels.controller);
        console.log(`Stopped ${opts.labels.controller}`);
      } catch (err) {
        console.error(`Error stopping ${opts.labels.controller}:`, err);
      }
    } else {
      console.log("Keeping services running in background");
    }

    // Remove handler and quit
    app.removeAllListeners("before-quit");
    app.quit();
  });
}

/**
 * Programmatically quit with a specific decision (for testing or automation).
 */
export async function quitWithDecision(
  decision: "quit-completely" | "run-in-background",
  opts: QuitHandlerOptions,
): Promise<void> {
  if (opts.onBeforeQuit) {
    await opts.onBeforeQuit();
  }

  if (opts.webServer) {
    await opts.webServer.close();
  }

  if (decision === "quit-completely") {
    await opts.launchd.stopServiceGracefully(opts.labels.openclaw);
    await opts.launchd.stopServiceGracefully(opts.labels.controller);
  }

  app.quit();
}
