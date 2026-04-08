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
import { getScriptsDevLogger } from "./shared/logger.js";
import { defaultLogTailLineCount } from "./shared/logs.js";
import { createDevSessionId } from "./shared/trace.js";

const cli = cac("scripts-dev");

function getCliLogger() {
  return getScriptsDevLogger({ component: "cli" });
}

async function runDefaultStartStage(
  target: DevTarget,
  sessionId: string,
): Promise<void> {
  const logger = getCliLogger();
  logger.info("starting service", { target, sessionId });
  await startTarget(target, sessionId);
  logger.info("startup stage complete", { target, sessionId });
}

async function runDefaultStopStage(target: DevTarget): Promise<void> {
  const logger = getCliLogger();
  logger.info("stopping service", { target });
  await stopTarget(target);
  logger.info("stop stage complete", { target });
}

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
  await runDefaultStartStage("openclaw", createDevSessionId());
  await runDefaultStartStage("controller", createDevSessionId());
  await runDefaultStartStage("web", createDevSessionId());
  await runDefaultStartStage("desktop", createDevSessionId());
}

async function stopDefaultStack(): Promise<void> {
  for (const target of ["desktop", "web", "controller", "openclaw"] as const) {
    try {
      await runDefaultStopStage(target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("is not running")) {
        getCliLogger().info(`${target} already stopped`, { target });
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

async function printDefaultStackStatus(): Promise<void> {
  for (const target of ["openclaw", "controller", "web", "desktop"] as const) {
    await printStatus(target);
  }
}

async function startTarget(
  target: DevTarget,
  sessionId: string,
): Promise<void> {
  if (target === "desktop") {
    const desktopFact = await startDesktopDevProcess({ sessionId });
    getCliLogger().info("desktop started", desktopFact);
    return;
  }

  if (target === "openclaw") {
    const openclawFact = await startOpenclawDevProcess({ sessionId });
    getCliLogger().info("openclaw started", openclawFact);
    return;
  }

  if (target === "controller") {
    const openclawSnapshot = await getCurrentOpenclawDevSnapshot();

    if (openclawSnapshot.status !== "running") {
      getCliLogger().info(
        "openclaw is not running; starting openclaw for controller",
        {
          target,
          openclawStatus: openclawSnapshot.status,
        },
      );

      const openclawFact = await startOpenclawDevProcess({
        sessionId: createDevSessionId(),
      });
      getCliLogger().info("openclaw started", openclawFact);
    }

    const controllerFact = await startControllerDevProcess({ sessionId });
    getCliLogger().info("controller started", controllerFact);
    return;
  }

  if (target === "web") {
    const webFact = await startWebDevProcess({ sessionId });
    getCliLogger().info("web started", webFact);
    return;
  }

  throw new Error(`unsupported start target: ${target}`);
}

async function stopTarget(target: DevTarget): Promise<void> {
  if (target === "desktop") {
    const desktopFact = await stopDesktopDevProcess();
    getCliLogger().info("desktop stopped", desktopFact);
    return;
  }

  if (target === "openclaw") {
    const openclawFact = await stopOpenclawDevProcess();
    getCliLogger().info("openclaw stopped", openclawFact);
    return;
  }

  if (target === "controller") {
    const controllerFact = await stopControllerDevProcess();
    getCliLogger().info("controller stopped", controllerFact);
    return;
  }

  if (target === "web") {
    const webFact = await stopWebDevProcess();
    getCliLogger().info("web stopped", webFact);
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
    getCliLogger().info("desktop restarted", desktopFact);
    return;
  }

  if (target === "openclaw") {
    const openclawFact = await restartOpenclawDevProcess({ sessionId });
    getCliLogger().info("openclaw restarted", openclawFact);
    return;
  }

  if (target === "controller") {
    const openclawSnapshot = await getCurrentOpenclawDevSnapshot();

    if (openclawSnapshot.status !== "running") {
      getCliLogger().info(
        "openclaw is not running; starting openclaw for controller restart",
        {
          target,
          openclawStatus: openclawSnapshot.status,
        },
      );

      const openclawFact = await startOpenclawDevProcess({
        sessionId: createDevSessionId(),
      });
      getCliLogger().info("openclaw started", openclawFact);
    }

    const controllerFact = await restartControllerDevProcess({ sessionId });
    getCliLogger().info("controller restarted", controllerFact);
    return;
  }

  if (target === "web") {
    const webFact = await restartWebDevProcess({ sessionId });
    getCliLogger().info("web restarted", webFact);
    return;
  }

  throw new Error(`unsupported restart target: ${target}`);
}

async function printStatus(target: DevTarget): Promise<void> {
  if (target === "desktop") {
    const desktopSnapshot = await getCurrentDesktopDevSnapshot();
    getCliLogger().info("desktop status", desktopSnapshot);
    return;
  }

  if (target === "openclaw") {
    const openclawSnapshot = await getCurrentOpenclawDevSnapshot();
    getCliLogger().info("openclaw status", openclawSnapshot);
    return;
  }

  if (target === "controller") {
    const controllerSnapshot = await getCurrentControllerDevSnapshot();
    getCliLogger().info("controller status", controllerSnapshot);
    return;
  }

  if (target === "web") {
    const webSnapshot = await getCurrentWebDevSnapshot();
    getCliLogger().info("web status", webSnapshot);
    return;
  }

  throw new Error(`unsupported status target: ${target}`);
}

function printLogHeader(logFilePath: string, totalLineCount: number): void {
  getCliLogger().info("showing current session log tail", {
    totalLines: totalLineCount,
    maxLines: defaultLogTailLineCount,
    logFilePath,
  });
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
    if (!target) {
      await printDefaultStackStatus();
      return;
    }

    const resolvedTarget = readTargetOrThrow(target);
    await printStatus(resolvedTarget);
  });

cli
  .command("logs [target]", "Print the local dev logs")
  .action(async (target?: string) => {
    if (!target) {
      throw new Error(
        "log target is required; run `pnpm dev status` to choose a service, then use `pnpm dev logs <desktop|openclaw|controller|web>`",
      );
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
  getCliLogger().error("unknown command", { command: fallbackCommand });
  process.exit(1);
}

cli.parse();
