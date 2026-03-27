import { type ChildProcess, spawn } from "node:child_process";

export function createNodeOptions(): string {
  const existing = process.env.NODE_OPTIONS?.trim();

  if (existing) {
    return `${existing} --conditions=development`;
  }

  return "--conditions=development";
}

export async function terminateProcess(pid: number): Promise<void> {
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const child = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });

      child.once("error", reject);
      child.once("exit", (code) => {
        if (code === 0) {
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
