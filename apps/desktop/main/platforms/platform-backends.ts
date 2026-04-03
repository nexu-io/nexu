import { execFileSync } from "node:child_process";
import { isDesktopPortProbeRetryableError } from "@nexu/shared";
import { LaunchdManager } from "../services/launchd-manager";
import { resolveRuntimePlatform } from "./platform-resolver";

function getListeningPidByPort(port: number): number | null {
  try {
    switch (resolveRuntimePlatform()) {
      case "win": {
        const output = execFileSync("netstat", ["-ano", "-p", "tcp"], {
          encoding: "utf-8",
        });

        for (const rawLine of output.split(/\r?\n/u)) {
          const line = rawLine.trim();
          if (!line.startsWith("TCP")) {
            continue;
          }

          const columns = line.split(/\s+/u);
          if (columns.length < 5 || columns[3] !== "LISTENING") {
            continue;
          }

          const localAddress = columns[1] ?? "";
          const localPort = Number.parseInt(
            localAddress.split(":").at(-1) ?? "",
            10,
          );
          if (localPort !== port) {
            continue;
          }

          const pid = Number.parseInt(columns[4] ?? "", 10);
          return Number.isInteger(pid) && pid > 0 ? pid : null;
        }

        return null;
      }
      case "mac": {
        const output = execFileSync(
          "lsof",
          [`-tiTCP:${String(port)}`, "-sTCP:LISTEN"],
          {
            encoding: "utf-8",
            stdio: ["ignore", "pipe", "ignore"],
          },
        ).trim();

        const pid = Number.parseInt(
          output.split(/\r?\n/u).find(Boolean) ?? "",
          10,
        );
        return Number.isInteger(pid) && pid > 0 ? pid : null;
      }
    }
  } catch {
    return null;
  }
}

function isPortProbeRetryableError(errorCode: unknown): boolean {
  return isDesktopPortProbeRetryableError({
    platformId: resolveRuntimePlatform(),
    errorCode,
  });
}

function createLaunchdSupervisor(opts?: { plistDir?: string }): LaunchdManager {
  if (resolveRuntimePlatform() !== "mac") {
    throw new Error("Launchd supervisor only works on macOS");
  }

  return new LaunchdManager(opts);
}

export const platform = {
  process: {
    getListeningPidByPort,
  },
  network: {
    isPortProbeRetryableError,
  },
  supervisor: {
    createLaunchdSupervisor,
  },
};
