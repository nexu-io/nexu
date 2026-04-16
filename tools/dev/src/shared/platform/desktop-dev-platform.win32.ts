import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { repoRootPath } from "@nexu/dev-utils";

import {
  desktopWorkingDirectoryPath,
  getDesktopRuntimeRootPath,
} from "../paths.js";

import type { DesktopDevLaunchSpec } from "./desktop-dev-platform.darwin.js";

type WindowsDesktopDevLaunchSpecOptions = {
  launchId: string;
  env: NodeJS.ProcessEnv;
  logFilePath: string;
  command?: string;
  args?: string[];
  cwd?: string;
};

type WindowsDesktopProcessRecord = {
  ProcessId: number;
  Name?: string;
  CommandLine?: string | null;
};

const execFileAsync = promisify(execFile);
const requireFromDesktop = createRequire(
  join(desktopWorkingDirectoryPath, "package.json"),
);

function resolveWindowsElectronExecutablePath(): string {
  const electronPackageJsonPath = requireFromDesktop.resolve(
    "electron/package.json",
  );
  const electronPackageRoot = dirname(electronPackageJsonPath);

  return join(electronPackageRoot, "dist", "electron.exe");
}

function escapePowerShellString(value: string): string {
  return value.replaceAll("'", "''");
}

function normalizeWindowsProcessRecords(
  value: unknown,
): WindowsDesktopProcessRecord[] {
  if (!value) {
    return [];
  }

  const records = Array.isArray(value) ? value : [value];

  return records
    .filter((record): record is Record<string, unknown> => Boolean(record))
    .map((record) => ({
      ProcessId:
        typeof record.ProcessId === "number"
          ? record.ProcessId
          : Number(record.ProcessId),
      Name: typeof record.Name === "string" ? record.Name : undefined,
      CommandLine:
        typeof record.CommandLine === "string" ? record.CommandLine : null,
    }))
    .filter(
      (record) => Number.isInteger(record.ProcessId) && record.ProcessId > 0,
    );
}

async function queryWindowsProcesses(
  script: string,
): Promise<WindowsDesktopProcessRecord[]> {
  const result = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  const trimmed = result.stdout.trim();

  if (!trimmed) {
    return [];
  }

  return normalizeWindowsProcessRecords(JSON.parse(trimmed) as unknown);
}

function buildDesktopProcessQuery(launchId?: string): string {
  const markerFilter = launchId
    ? `$_.CommandLine -like '*--nexu-desktop-launch-id=${escapePowerShellString(launchId)}*'`
    : "$_.CommandLine -like '*apps/desktop*'";

  return [
    "$ErrorActionPreference = 'Stop'",
    "Get-CimInstance Win32_Process | Where-Object {",
    "  $_.CommandLine -and (",
    `    ${markerFilter}`,
    "  )",
    "} | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress",
  ].join("\n");
}

async function getWindowsDesktopProcesses(
  launchId?: string,
): Promise<WindowsDesktopProcessRecord[]> {
  try {
    return await queryWindowsProcesses(buildDesktopProcessQuery(launchId));
  } catch {
    return [];
  }
}

async function terminateWindowsPid(pid: number, force: boolean): Promise<void> {
  const args = ["/PID", String(pid), "/T"];

  if (force) {
    args.push("/F");
  }

  try {
    await execFileAsync("taskkill.exe", args, { windowsHide: true });
  } catch {
    try {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
    } catch {}
  }
}

export async function createWindowsDesktopDevLaunchSpec(
  options: WindowsDesktopDevLaunchSpecOptions,
): Promise<DesktopDevLaunchSpec> {
  const markerArg = `--nexu-desktop-launch-id=${options.launchId}`;

  return {
    command: options.command ?? resolveWindowsElectronExecutablePath(),
    args: options.args
      ? [...options.args, markerArg]
      : [desktopWorkingDirectoryPath, markerArg],
    cwd: options.cwd ?? desktopWorkingDirectoryPath,
    env: {
      ...options.env,
      NEXU_WORKSPACE_ROOT: repoRootPath,
      NEXU_DESKTOP_APP_ROOT: desktopWorkingDirectoryPath,
      NEXU_DESKTOP_RUNTIME_ROOT: getDesktopRuntimeRootPath(),
    },
  };
}

export async function findWindowsDesktopDevMainPid(
  launchId?: string,
): Promise<number | undefined> {
  const processes = await getWindowsDesktopProcesses(launchId);
  const electronProcess = processes.find(
    (processRecord) => processRecord.Name?.toLowerCase() === "electron.exe",
  );

  return electronProcess?.ProcessId;
}

export async function terminateWindowsDesktopDevProcesses(
  pid?: number,
  options?: { force?: boolean; launchId?: string },
): Promise<void> {
  const force = options?.force ?? false;
  const pids = new Set<number>();

  if (pid) {
    pids.add(pid);
  }

  const processes = await getWindowsDesktopProcesses(options?.launchId);
  for (const processRecord of processes) {
    pids.add(processRecord.ProcessId);
  }

  for (const currentPid of pids) {
    await terminateWindowsPid(currentPid, force);
  }
}
