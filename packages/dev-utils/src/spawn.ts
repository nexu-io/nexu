import { type ChildProcess, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";

import { ensure } from "@nexu/shared";

import {
  getDevLauncherTempPrefix,
  getWindowsLauncherBatchPath,
  getWindowsLauncherScriptPath,
} from "./paths.js";

type SpawnHiddenProcessArgs = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  logFilePath: string;
};

type HiddenProcessHandle = {
  pid: number;
  child?: ChildProcess;
  dispose: () => void;
};

function quoteForCmd(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function spawnWindowsHiddenProcess({
  command,
  args,
  cwd,
  env,
  logFilePath,
}: SpawnHiddenProcessArgs): Promise<HiddenProcessHandle> {
  const startedAt = Date.now();
  const service = env.NEXU_DEV_SERVICE ?? "unknown";
  const launcherDirectory = await mkdtemp(getDevLauncherTempPrefix());
  const batchPath = getWindowsLauncherBatchPath(launcherDirectory);
  const launcherPath = getWindowsLauncherScriptPath(launcherDirectory);
  const commandText = [command, ...args].map(quoteForCmd).join(" ");
  const batchSource = [
    "@echo off",
    `cd /d ${quoteForCmd(cwd)}`,
    `${commandText} >> ${quoteForCmd(logFilePath)} 2>&1`,
  ].join("\r\n");
  const launcherSource = [
    'Set shell = CreateObject("WScript.Shell")',
    "shell.CurrentDirectory = WScript.Arguments(0)",
    'exitCode = shell.Run("launcher.cmd", 0, True)',
    "WScript.Quit exitCode",
  ].join("\r\n");

  await writeFile(batchPath, `${batchSource}\r\n`, "utf8");
  await writeFile(launcherPath, `${launcherSource}\r\n`, "utf8");

  console.log(
    `[scripts-dev][spawn-hidden] service=${service} stage=launcher-prepared elapsedMs=${Date.now() - startedAt} dir=${launcherDirectory}`,
  );

  const child = spawn(
    "wscript.exe",
    ["//nologo", launcherPath, launcherDirectory],
    {
      cwd,
      env,
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    },
  );

  if (!child.pid) {
    await rm(launcherDirectory, { recursive: true, force: true });
  }

  ensure(Boolean(child.pid)).orThrow(
    () => new Error("hidden process did not expose a pid"),
  );
  const pid = child.pid as number;

  console.log(
    `[scripts-dev][spawn-hidden] service=${service} stage=wscript-spawned elapsedMs=${Date.now() - startedAt} pid=${pid}`,
  );

  child.once("exit", () => {
    void rm(launcherDirectory, { recursive: true, force: true });
  });

  return {
    pid,
    child,
    dispose: () => {
      child.unref();
    },
  };
}

function spawnPosixHiddenProcess({
  command,
  args,
  cwd,
  env,
  logFilePath,
}: SpawnHiddenProcessArgs): HiddenProcessHandle {
  const logFd = openSync(logFilePath, "a");
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: true,
    windowsHide: true,
  });

  if (!child.pid) {
    closeSync(logFd);
  }

  ensure(Boolean(child.pid)).orThrow(
    () => new Error("hidden process did not expose a pid"),
  );
  const pid = child.pid as number;

  return {
    pid,
    child,
    dispose: () => {
      child.unref();
      closeSync(logFd);
    },
  };
}

export async function spawnHiddenProcess(
  args: SpawnHiddenProcessArgs,
): Promise<HiddenProcessHandle> {
  if (process.platform === "win32") {
    return spawnWindowsHiddenProcess(args);
  }

  return spawnPosixHiddenProcess(args);
}
