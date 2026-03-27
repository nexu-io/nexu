import { isSupportedDevCommand } from "@nexu/dev-utils";
import { cac } from "cac";

import {
  getCurrentControllerDevSnapshot,
  readControllerDevLog,
  restartControllerDevProcess,
  startControllerDevProcess,
  stopControllerDevProcess,
} from "./controller-dev.js";
import { createDevSessionId } from "./dev-trace.js";
import {
  getCurrentWebDevSnapshot,
  readWebDevLog,
  restartWebDevProcess,
  startWebDevProcess,
  stopWebDevProcess,
} from "./web-dev.js";

const cli = cac("scripts-dev");

cli.command("start", "Start the local dev flow").action(async () => {
  const sessionId = createDevSessionId();
  const controllerFact = await startControllerDevProcess({ sessionId });
  console.log(`[scripts-dev] controller started (${controllerFact.pid})`);
  console.log(`[scripts-dev] controller run id: ${controllerFact.runId}`);
  console.log(
    `[scripts-dev] controller session id: ${controllerFact.sessionId}`,
  );
  console.log(
    `[scripts-dev] controller log file: ${controllerFact.logFilePath}`,
  );

  const webFact = await startWebDevProcess({ sessionId });
  console.log(`[scripts-dev] web started (${webFact.pid})`);
  console.log(`[scripts-dev] web run id: ${webFact.runId}`);
  console.log(`[scripts-dev] web session id: ${webFact.sessionId}`);
  console.log(`[scripts-dev] web log file: ${webFact.logFilePath}`);
});

cli.command("restart", "Restart the local dev flow").action(async () => {
  const sessionId = createDevSessionId();
  const controllerFact = await restartControllerDevProcess({ sessionId });
  console.log(`[scripts-dev] controller restarted (${controllerFact.pid})`);
  console.log(`[scripts-dev] controller run id: ${controllerFact.runId}`);
  console.log(
    `[scripts-dev] controller session id: ${controllerFact.sessionId}`,
  );
  console.log(
    `[scripts-dev] controller log file: ${controllerFact.logFilePath}`,
  );

  const webFact = await restartWebDevProcess({ sessionId });
  console.log(`[scripts-dev] web restarted (${webFact.pid})`);
  console.log(`[scripts-dev] web run id: ${webFact.runId}`);
  console.log(`[scripts-dev] web session id: ${webFact.sessionId}`);
  console.log(`[scripts-dev] web log file: ${webFact.logFilePath}`);
});

cli.command("stop", "Stop the local dev flow").action(async () => {
  const webFact = await stopWebDevProcess();
  console.log(`[scripts-dev] web stopped (${webFact.pid})`);
  console.log(`[scripts-dev] web last run id: ${webFact.runId}`);

  const controllerFact = await stopControllerDevProcess();
  console.log(`[scripts-dev] controller stopped (${controllerFact.pid})`);
  console.log(`[scripts-dev] controller last run id: ${controllerFact.runId}`);
});

cli.command("status", "Show the local dev status").action(async () => {
  const controllerSnapshot = await getCurrentControllerDevSnapshot();
  const webSnapshot = await getCurrentWebDevSnapshot();

  console.log(`[scripts-dev] controller status: ${controllerSnapshot.status}`);
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
    console.log(`[scripts-dev] controller run id: ${controllerSnapshot.runId}`);
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
});

cli
  .command("logs [target]", "Print the local dev logs")
  .action(async (target?: string) => {
    if (!target) {
      throw new Error("log target is required; use `pnpm dev logs web`");
    }

    if (target !== "web") {
      if (target !== "controller") {
        throw new Error(`unsupported log target: ${target}`);
      }

      const snapshot = await getCurrentControllerDevSnapshot();

      if (!snapshot.logFilePath) {
        throw new Error("controller log file is unavailable");
      }

      console.log(`[scripts-dev] log file: ${snapshot.logFilePath}`);
      const content = await readControllerDevLog();
      process.stdout.write(content);
      return;
    }

    const snapshot = await getCurrentWebDevSnapshot();

    if (!snapshot.logFilePath) {
      throw new Error("web log file is unavailable");
    }

    console.log(`[scripts-dev] log file: ${snapshot.logFilePath}`);
    const content = await readWebDevLog();
    process.stdout.write(content);
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
