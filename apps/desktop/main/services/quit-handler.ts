/**
 * Quit Handler - Desktop exit behavior with launchd services
 *
 * Provides quit dialog with options:
 * - Quit Completely: stop all launchd services and exit
 * - Run in Background: close GUI, keep services running
 * - Cancel: don't quit
 */

import { BrowserWindow, app, dialog } from "electron";
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
  let handling = false;

  app.on("before-quit", async (event) => {
    if (handling) return;

    event.preventDefault();
    handling = true;

    const decision: QuitDecision = app.isPackaged
      ? await showQuitDialog()
      : "run-in-background";

    if (decision === "cancel") {
      handling = false;
      return;
    }

    if (decision === "run-in-background") {
      // Just hide windows — don't stop services, don't close web server
      for (const win of BrowserWindow.getAllWindows()) {
        win.hide();
      }
      handling = false;
      return;
    }

    // "quit-completely" — full cleanup and exit
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

    console.log("Stopping launchd services...");
    for (const label of [opts.labels.openclaw, opts.labels.controller]) {
      try {
        await opts.launchd.bootoutService(label);
        console.log(`Booted out ${label}`);
      } catch (err) {
        console.error(`Error booting out ${label}:`, err);
      }
    }

    opts.onForceQuit?.();
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
    try {
      await opts.launchd.bootoutService(opts.labels.openclaw);
      await opts.launchd.bootoutService(opts.labels.controller);
    } catch (err) {
      console.error("Error stopping services:", err);
    }
  }

  app.quit();
}
