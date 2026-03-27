import { spawn } from "node:child_process";

import { waitFor } from "@nexu/dev-utils";

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
  options: { attempts: number; delayMs?: number },
): Promise<number> {
  return waitFor(
    () => getListeningPortPid(port, serviceName),
    () => new Error(`${serviceName} did not open port ${port}`),
    options,
  );
}
