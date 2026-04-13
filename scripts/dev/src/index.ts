import { cac } from "cac";

import {
  getCurrentControllerDevSnapshot,
  readControllerDevLog,
  restartControllerDevProcess,
  startControllerDevProcess,
  stopControllerDevProcess,
} from "./services/controller.js";
import {
  captureDesktopDevInspectScreenshot,
  evaluateDesktopDevInspectScript,
  getCurrentDesktopDevSnapshot,
  getDesktopDevInspectDomSnapshot,
  getDesktopDevInspectRendererLogs,
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

const devTargets = ["desktop", "openclaw", "controller", "web"] as const;

type DevTarget = (typeof devTargets)[number];

type SnapshotLike = {
  service: string;
  status: "running" | "stopped" | "stale";
  staleReason?: string;
};

function warnIfSnapshotIsStale(snapshot: SnapshotLike): void {
  if (snapshot.status !== "stale") {
    return;
  }

  getCliLogger().warn(`${snapshot.service} is stale`, {
    service: snapshot.service,
    staleReason: snapshot.staleReason ?? "unknown stale reason",
  });
}

function getNoActiveLogMessage(snapshot: SnapshotLike): string {
  if (snapshot.status === "stale") {
    return snapshot.staleReason
      ? `${snapshot.service} is stale (${snapshot.staleReason}); active session logs may reflect the failed run`
      : `${snapshot.service} is stale; active session logs may reflect the failed run`;
  }

  return `${snapshot.service} is not running; no active session log is available`;
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

  if (!(devTargets as readonly string[]).includes(target)) {
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
    warnIfSnapshotIsStale(desktopSnapshot);
    return;
  }

  if (target === "openclaw") {
    const openclawSnapshot = await getCurrentOpenclawDevSnapshot();
    getCliLogger().info("openclaw status", openclawSnapshot);
    warnIfSnapshotIsStale(openclawSnapshot);
    return;
  }

  if (target === "controller") {
    const controllerSnapshot = await getCurrentControllerDevSnapshot();
    getCliLogger().info("controller status", controllerSnapshot);
    warnIfSnapshotIsStale(controllerSnapshot);
    return;
  }

  if (target === "web") {
    const webSnapshot = await getCurrentWebDevSnapshot();
    getCliLogger().info("web status", webSnapshot);
    warnIfSnapshotIsStale(webSnapshot);
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

function readOptionalPositiveNumber(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed =
    typeof value === "number" ? value : Number.parseInt(String(value), 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`expected a positive integer, received: ${String(value)}`);
  }

  return parsed;
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
  .command("logs <target>", "Print the local dev logs")
  .action(async (target: string) => {
    const resolvedTarget = readTargetOrThrow(target);

    if (resolvedTarget === "desktop") {
      const snapshot = await getCurrentDesktopDevSnapshot();

      if (snapshot.status === "stopped") {
        throw new Error(getNoActiveLogMessage(snapshot));
      }

      warnIfSnapshotIsStale(snapshot);

      const content = await readDesktopDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      process.stdout.write(content.content);
      return;
    }

    if (resolvedTarget === "openclaw") {
      const snapshot = await getCurrentOpenclawDevSnapshot();

      if (snapshot.status === "stopped") {
        throw new Error(getNoActiveLogMessage(snapshot));
      }

      warnIfSnapshotIsStale(snapshot);

      const content = await readOpenclawDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      process.stdout.write(content.content);
      return;
    }

    if (resolvedTarget === "controller") {
      const snapshot = await getCurrentControllerDevSnapshot();

      if (snapshot.status === "stopped") {
        throw new Error(getNoActiveLogMessage(snapshot));
      }

      warnIfSnapshotIsStale(snapshot);

      const content = await readControllerDevLog();
      printLogHeader(content.logFilePath, content.totalLineCount);
      process.stdout.write(content.content);
      return;
    }

    const snapshot = await getCurrentWebDevSnapshot();

    if (snapshot.status === "stopped") {
      throw new Error(getNoActiveLogMessage(snapshot));
    }

    warnIfSnapshotIsStale(snapshot);

    const content = await readWebDevLog();
    printLogHeader(content.logFilePath, content.totalLineCount);
    process.stdout.write(content.content);
  });

cli
  .command("inspect screenshot", "Capture a desktop dev screenshot")
  .option("--out <path>", "Write screenshot PNG to this path")
  .action(async (options?: { out?: string }) => {
    const result = await captureDesktopDevInspectScreenshot({
      outputPath: options?.out,
    });
    process.stdout.write(`${result.outputPath}\n`);
  });

cli
  .command("inspect eval <input>", "Evaluate a desktop dev renderer script")
  .action(async (input: string) => {
    const result = await evaluateDesktopDevInspectScript(input);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

cli
  .command("inspect dom", "Dump the desktop dev renderer DOM summary")
  .option("--max-html-length <number>", "Cap returned DOM HTML length")
  .action(async (options?: { maxHtmlLength?: string | number }) => {
    const result = await getDesktopDevInspectDomSnapshot({
      maxHtmlLength: readOptionalPositiveNumber(options?.maxHtmlLength),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

cli
  .command("inspect logs", "Show buffered desktop dev renderer logs")
  .option("--limit <number>", "Limit renderer log entries")
  .action(async (options?: { limit?: string | number }) => {
    const result = await getDesktopDevInspectRendererLogs({
      limit: readOptionalPositiveNumber(options?.limit),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  });

cli.help();

cli.parse();
