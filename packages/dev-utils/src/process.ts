import { type ChildProcess, spawn } from "node:child_process";

import { waitFor } from "./conditions.js";

export function createNodeOptions(): string {
  const existing = process.env.NODE_OPTIONS?.trim();

  if (existing) {
    return `${existing} --conditions=development`;
  }

  return "--conditions=development";
}

export async function terminateProcess(pid: number): Promise<void> {
  if (!isProcessRunning(pid)) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });

      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0 || !isProcessRunning(pid)) {
          resolve();
          return;
        }

        reject(new Error(`taskkill exited with code ${code ?? 1}`));
      });
    });

    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
    return;
  } catch {
    process.kill(pid, "SIGTERM");
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function waitForProcessStart(
  child: ChildProcess,
  processName: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, 1000);

    function cleanup(): void {
      clearTimeout(timer);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    }

    function onError(error: Error): void {
      cleanup();
      reject(error);
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null): void {
      cleanup();
      reject(
        new Error(
          `${processName} exited early (code: ${code ?? "none"}, signal: ${signal ?? "none"})`,
        ),
      );
    }

    child.once("error", onError);
    child.once("exit", onExit);
  });
}

export async function waitForChildExit(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
}

export async function getListeningPortPid(
  port: number,
  serviceName: string,
): Promise<number> {
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn("netstat", ["-ano"], {
      stdio: ["ignore", "pipe", "inherit"],
    });

    let stdout = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(`netstat exited with code ${code ?? 1}`));
    });
  });

  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    if (!line.includes(`:${port}`) || !line.includes("LISTENING")) {
      continue;
    }

    const columns = line.trim().split(/\s+/);
    const pidText = columns.at(-1);

    if (!pidText) {
      continue;
    }

    const pid = Number(pidText);

    if (Number.isNaN(pid)) {
      continue;
    }

    return pid;
  }

  throw new Error(`${serviceName} did not open port ${port}`);
}

export async function waitForListeningPortPid(
  port: number,
  serviceName: string,
  options: {
    attempts: number;
    delayMs?: number;
    supervisorPid?: number;
    supervisorName?: string;
  },
): Promise<number> {
  const supervisorLabel = options.supervisorName ?? `${serviceName} supervisor`;

  if (options.supervisorPid) {
    for (let index = 0; index < options.attempts; index += 1) {
      try {
        return await getListeningPortPid(port, serviceName);
      } catch {}

      if (!isProcessRunning(options.supervisorPid)) {
        throw new Error(
          `${supervisorLabel} exited before opening port ${port}`,
        );
      }

      if (index < options.attempts - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, options.delayMs ?? 250),
        );
      }
    }

    if (!isProcessRunning(options.supervisorPid)) {
      throw new Error(`${supervisorLabel} exited before opening port ${port}`);
    }

    throw new Error(`${serviceName} did not open port ${port}`);
  }

  return waitFor(
    () => getListeningPortPid(port, serviceName),
    () => new Error(`${serviceName} did not open port ${port}`),
    options,
  );
}
