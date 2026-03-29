import { cac } from "cac";

import {
  type DevTarget,
  isSupportedDevCommand,
  isSupportedDevTarget,
} from "./commands.js";
import {
  getCurrentControllerDevSnapshot,
  readControllerDevLog,
  restartControllerDevProcess,
  startControllerDevProcess,
  stopControllerDevProcess,
} from "./services/controller.js";
import {
  getCurrentDesktopDevSnapshot,
  readDesktopDevLog,
  restartDesktopDevProcess,
  startDesktopDevProcess,
  stopDesktopDevProcess,
} from "./services/desktop.js";
import {
  getCurrentOpenclawDevSnapshot,
  readOpenclawDevLog,
  restartOpenclawDevProcess,
  startOpenclawDevProcess,
  stopOpenclawDevProcess,
} from "./services/openclaw.js";
import {
  getCurrentWebDevSnapshot,
  readWebDevLog,
  restartWebDevProcess,
  startWebDevProcess,
  stopWebDevProcess,
} from "./services/web.js";
import { defaultLogTailLineCount } from "./shared/logs.js";
import { createDevSessionId } from "./shared/trace.js";

const cli = cac("scripts-dev");

function readTargetOrThrow(target: string | undefined): DevTarget {
  if (!target) {
    throw new Error(
      "target is required; use `pnpm dev <start|status|stop|restart> <desktop|openclaw|controller|web>`",
    );
  }

  if (!isSupportedDevTarget(target)) {
    throw new Error(`unsupported target: ${target}`);
  }

  return target as DevTarget;
}

async function startDefaultStack(): Promise<void> {
  await startTarget("openclaw", createDevSessionId());
  await startTarget("controller", createDevSessionId());
  await startTarget("web", createDevSessionId());
  await startTarget("desktop", createDevSessionId());
}

async function stopDefaultStack(): Promise<void> {
  for (const target of ["desktop", "web", "controller", "openclaw"] as const) {
    try {
      await stopTarget(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("is not running")) {
        console.log(`[scripts-dev] ${target} already stopped`);
        continue;
      }

      throw error;
    }
  }
}

async function restartDefaultStack(): Promise<void> {
  await stopDefaultStack();
  await startDefaultStack();
}

async function startTarget(
  target: DevTarget,
  sessionId: string,
): Promise<void> {
  if (target === "desktop") {
    const desktopFact = await startDesktopDevProcess({ sessionId });
    console.log(`[scripts-dev] desktop started (${desktopFact.pid})`);
    console.log(`[scripts-dev] desktop launch id: ${desktopFact.launchId}`);
    console.log(`[scripts-dev] desktop run id: ${desktopFact.runId}`);
    console.log(`[scripts-dev] desktop session id: ${desktopFact.sessionId}`);
    console.log(`[scripts-dev] desktop log file: ${desktopFact.logFilePath}`);
    return;
  }

  if (target === "openclaw") {
    const openclawFact = await startOpenclawDevProcess({ sessionId });
    console.log(`[scripts-dev] openclaw started (${openclawFact.pid})`);
    console.log(`[scripts-dev] openclaw run id: ${openclawFact.runId}`);
    console.log(`[scripts-dev] openclaw session id: ${openclawFact.sessionId}`);
    console.log(`[scripts-dev] openclaw log file: ${openclawFact.logFilePath}`);
    return;
  }

  if (target === "controller") {
    const controllerFact = await startControllerDevProcess({ sessionId });
    console.log(`[scripts-dev] controller started (${controllerFact.pid})`);
    console.log(`[scripts-dev] controller run id: ${controllerFact.runId}`);
    console.log(
      `[scripts-dev] controller session id: ${controllerFact.sessionId}`,
    );
    console.log(
      `[scripts-dev] controller log file: ${controllerFact.logFilePath}`,
    );
    return;
  }

  if (target === "web") {
    const webFact = await startWebDevProcess({ sessionId });
    console.log(`[scripts-dev] web started (${webFact.pid})`);
    console.log(`[scripts-dev] web run id: ${webFact.runId}`);
    console.log(`[scripts-dev] web session id: ${webFact.sessionId}`);
    console.log(`[scripts-dev] web log file: ${webFact.logFilePath}`);
    return;
  }

  throw new Error(`unsupported start target: ${target}`);
}

async function stopTarget(target: DevTarget): Promise<void> {
  if (target === "desktop") {
    const desktopFact = await stopDesktopDevProcess();
    console.log(`[scripts-dev] desktop stopped (${desktopFact.pid})`);
    console.log(`[scripts-dev] desktop last run id: ${desktopFact.runId}`);
    return;
  }

  if (target === "openclaw") {
    const openclawFact = await stopOpenclawDevProcess();
    console.log(`[scripts-dev] openclaw stopped (${openclawFact.pid})`);
    console.log(`[scripts-dev] openclaw last run id: ${openclawFact.runId}`);
    return;
  }

  if (target === "controller") {
    const controllerFact = await stopControllerDevProcess();
    console.log(`[scripts-dev] controller stopped (${controllerFact.pid})`);
    console.log(
      `[scripts-dev] controller last run id: ${controllerFact.runId}`,
    );
    return;
  }

  if (target === "web") {
    const webFact = await stopWebDevProcess();
    console.log(`[scripts-dev] web stopped (${webFact.pid})`);
    console.log(`[scripts-dev] web last run id: ${webFact.runId}`);
    return;
  }

  throw new Error(`unsupported stop target: ${target}`);
}

async function restartTarget(
  target: DevTarget,
  sessionId: string,
): Promise<void> {
  if (target === "desktop") {
    const desktopFact = await restartDesktopDevProcess({ sessionId });
    console.log(`[scripts-dev] desktop restarted (${desktopFact.pid})`);
    console.log(`[scripts-dev] desktop launch id: ${desktopFact.launchId}`);
    console.log(`[scripts-dev] desktop run id: ${desktopFact.runId}`);
    console.log(`[scripts-dev] desktop session id: ${desktopFact.sessionId}`);
    console.log(`[scripts-dev] desktop log file: ${desktopFact.logFilePath}`);
    return;
  }

  if (target === "openclaw") {
    const openclawFact = await restartOpenclawDevProcess({ sessionId });
    console.log(`[scripts-dev] openclaw restarted (${openclawFact.pid})`);
    console.log(`[scripts-dev] openclaw run id: ${openclawFact.runId}`);
    console.log(`[scripts-dev] openclaw session id: ${openclawFact.sessionId}`);
    console.log(`[scripts-dev] openclaw log file: ${openclawFact.logFilePath}`);
    return;
  }

  if (target === "controller") {
    const controllerFact = await restartControllerDevProcess({ sessionId });
    console.log(`[scripts-dev] controller restarted (${controllerFact.pid})`);
    console.log(`[scripts-dev] controller run id: ${controllerFact.runId}`);
    console.log(
      `[scripts-dev] controller session id: ${controllerFact.sessionId}`,
    );
    console.log(
      `[scripts-dev] controller log file: ${controllerFact.logFilePath}`,
    );
    return;
  }

  if (target === "web") {
    const webFact = await restartWebDevProcess({ sessionId });
    console.log(`[scripts-dev] web restarted (${webFact.pid})`);
    console.log(`[scripts-dev] web run id: ${webFact.runId}`);
    console.log(`[scripts-dev] web session id: ${webFact.sessionId}`);
    console.log(`[scripts-dev] web log file: ${webFact.logFilePath}`);
    return;
  }

  throw new Error(`unsupported restart target: ${target}`);
}

async function printStatus(target: DevTarget): Promise<void> {
  if (target === "desktop") {
    const desktopSnapshot = await getCurrentDesktopDevSnapshot();
    console.log(`[scripts-dev] desktop status: ${desktopSnapshot.status}`);
    if (desktopSnapshot.pid) {
      console.log(`[scripts-dev] desktop pid: ${desktopSnapshot.pid}`);
    }
    if (desktopSnapshot.launchId) {
      console.log(
        `[scripts-dev] desktop launch id: ${desktopSnapshot.launchId}`,
      );
    }
    if (desktopSnapshot.runId) {
      console.log(`[scripts-dev] desktop run id: ${desktopSnapshot.runId}`);
    }
    if (desktopSnapshot.sessionId) {
      console.log(
        `[scripts-dev] desktop session id: ${desktopSnapshot.sessionId}`,
      );
    }
    if (desktopSnapshot.logFilePath) {
      console.log(
        `[scripts-dev] desktop log file: ${desktopSnapshot.logFilePath}`,
      );
    }
    return;
  }

  if (target === "openclaw") {
    const openclawSnapshot = await getCurrentOpenclawDevSnapshot();
    console.log(`[scripts-dev] openclaw status: ${openclawSnapshot.status}`);
    if (openclawSnapshot.pid) {
      console.log(
        `[scripts-dev] openclaw supervisor pid: ${openclawSnapshot.pid}`,
      );
    }
    if (openclawSnapshot.listenerPid) {
      console.log(
        `[scripts-dev] openclaw listener pid: ${openclawSnapshot.listenerPid}`,
      );
    }
    if (openclawSnapshot.runId) {
      console.log(`[scripts-dev] openclaw run id: ${openclawSnapshot.runId}`);
    }
    if (openclawSnapshot.sessionId) {
      console.log(
        `[scripts-dev] openclaw session id: ${openclawSnapshot.sessionId}`,
      );
    }
    if (openclawSnapshot.logFilePath) {
      console.log(
        `[scripts-dev] openclaw log file: ${openclawSnapshot.logFilePath}`,
      );
    }
    return;
  }

  if (target === "controller") {
    const controllerSnapshot = await getCurrentControllerDevSnapshot();
    console.log(
      `[scripts-dev] controller status: ${controllerSnapshot.status}`,
    );
    if (controllerSnapshot.pid) {
      console.log(
        `[scripts-dev] controller supervisor pid: ${controllerSnapshot.pid}`,
      );
    }
    if (controllerSnapshot.workerPid) {
      console.log(
        `[scripts-dev] controller worker pid: ${controllerSnapshot.workerPid}`,
      );
    }
    if (controllerSnapshot.runId) {
      console.log(
        `[scripts-dev] controller run id: ${controllerSnapshot.runId}`,
      );
    }
    if (controllerSnapshot.sessionId) {
      console.log(
        `[scripts-dev] controller session id: ${controllerSnapshot.sessionId}`,
      );
    }
    if (controllerSnapshot.logFilePath) {
      console.log(
        `[scripts-dev] controller log file: ${controllerSnapshot.logFilePath}`,
      );
    }
    return;
  }

  if (target === "web") {
    const webSnapshot = await getCurrentWebDevSnapshot();
    console.log(`[scripts-dev] web status: ${webSnapshot.status}`);
    if (webSnapshot.pid) {
      console.log(`[scripts-dev] web pid: ${webSnapshot.pid}`);
    }
    if (webSnapshot.listenerPid) {
      console.log(`[scripts-dev] web listener pid: ${webSnapshot.listenerPid}`);
    }
    if (webSnapshot.runId) {
      console.log(`[scripts-dev] web run id: ${webSnapshot.runId}`);
    }
    if (webSnapshot.sessionId) {
      console.log(`[scripts-dev] web session id: ${webSnapshot.sessionId}`);
    }
    if (webSnapshot.logFilePath) {
      console.log(`[scripts-dev] web log file: ${webSnapshot.logFilePath}`);
    }
    return;
  }

  throw new Error(`unsupported status target: ${target}`);
}

function printLogHeader(logFilePath: string, totalLineCount: number): void {
  console.log(
    `[scripts-dev] showing current session log tail (last ${defaultLogTailLineCount} lines max)`,
  );
  console.log(`[scripts-dev] total lines: ${totalLineCount}`);
  console.log(`[scripts-dev] log file: ${logFilePath}`);
}

cli
  .command("start [target]", "Start one local dev service")
  .action(async (target?: string) => {
    if (!target) {
      await startDefaultStack();
      return;
    }

    const resolvedTarget = readTargetOrThrow(target);
    const sessionId = createDevSessionId();
    await startTarget(resolvedTarget, sessionId);
  });

cli
  .command("restart [target]", "Restart one local dev service")
  .action(async (target?: string) => {
    if (!target) {
      await restartDefaultStack();
      return;
    }

    const resolvedTarget = readTargetOrThrow(target);
    const sessionId = createDevSessionId();
    await restartTarget(resolvedTarget, sessionId);
  });

cli
  .command("stop [target]", "Stop one local dev service")
  .action(async (target?: string) => {
    if (!target) {
      await stopDefaultStack();
      return;
    }

    const resolvedTarget = readTargetOrThrow(target);
    await stopTarget(resolvedTarget);
  });

cli
  .command("status [target]", "Show status for one local dev service")
  .action(async (target?: string) => {
    const resolvedTarget = readTargetOrThrow(target);
    await printStatus(resolvedTarget);
  });

cli
  .command("logs [target]", "Print the local dev logs")
  .action(async (target?: string) => {
    if (!target) {
      throw new Error("log target is required; use `pnpm dev logs desktop`");
    }

    if (!isSupportedDevTarget(target)) {
      throw new Error(`unsupported log target: ${target}`);
    }

    if (target === "desktop") {
      const snapshot = await getCurrentDesktopDevSnapshot();

      if (snapshot.status === "stopped") {
        throw new Error(
          "desktop is not running; no active session log is available",
        );
      }

      const content = await readDesktopDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      process.stdout.write(content.content);
      return;
    }

    if (target === "openclaw") {
      const snapshot = await getCurrentOpenclawDevSnapshot();

      if (snapshot.status === "stopped") {
        throw new Error(
          "openclaw is not running; no active session log is available",
        );
      }

      const content = await readOpenclawDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      process.stdout.write(content.content);
      return;
    }

    if (target !== "web") {
      const snapshot = await getCurrentControllerDevSnapshot();

      if (snapshot.status === "stopped") {
        throw new Error(
          "controller is not running; no active session log is available",
        );
      }

      const content = await readControllerDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      process.stdout.write(content.content);
      return;
    }

    const snapshot = await getCurrentWebDevSnapshot();

    if (snapshot.status === "stopped") {
      throw new Error("web is not running; no active session log is available");
    }

    const content = await readWebDevLog();
    printLogHeader(content.logFilePath, content.totalLineCount);
    process.stdout.write(content.content);
  });

cli.command("help", "Show the CLI help output").action(() => {
  cli.outputHelp();
});

cli.help();

const fallbackCommand = process.argv[2];

if (fallbackCommand && !isSupportedDevCommand(fallbackCommand)) {
  console.error(`[scripts-dev] Unknown command: ${fallbackCommand}`);
  process.exit(1);
}

cli.parse();
