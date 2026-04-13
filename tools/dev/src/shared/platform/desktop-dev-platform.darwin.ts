import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { repoRootPath } from "@nexu/dev-utils";

import {
  desktopWorkingDirectoryPath,
  getDesktopRuntimeRootPath,
} from "../paths.js";

const execFileAsync = promisify(execFile);
const requireFromDesktop = createRequire(
  join(desktopWorkingDirectoryPath, "package.json"),
);

export type DesktopDevLaunchSpec = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
};

const darwinDesktopUserDataArg = `--user-data-dir=${join(
  getDesktopRuntimeRootPath(),
  "electron",
  "user-data",
)}`;
const darwinDesktopWrapperMatch = "pnpm exec electron apps/desktop";

type DarwinDesktopDevLaunchSpecOptions = {
  launchId: string;
  env: NodeJS.ProcessEnv;
  logFilePath: string;
  command?: string;
  args?: string[];
  cwd?: string;
};

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
    ) {
      values[key] = rawValue.slice(1, -1);
      continue;
    }

    values[key] = rawValue;
  }

  return values;
}

async function readOptionalEnvFile(
  filePath: string,
): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }

    throw error;
  }
}

async function resolveDesktopLaunchEnv(
  env: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const [rootEnv, controllerEnv, desktopEnv] = await Promise.all([
    readOptionalEnvFile(resolve(repoRootPath, ".env")),
    readOptionalEnvFile(resolve(repoRootPath, "apps/controller/.env")),
    readOptionalEnvFile(resolve(desktopWorkingDirectoryPath, ".env")),
  ]);

  return {
    ...rootEnv,
    ...controllerEnv,
    ...desktopEnv,
    ...env,
    NEXU_WORKSPACE_ROOT: repoRootPath,
    NEXU_DESKTOP_APP_ROOT: desktopWorkingDirectoryPath,
    NEXU_DESKTOP_RUNTIME_ROOT: getDesktopRuntimeRootPath(),
  };
}

function resolveElectronExecutablePath(): string {
  const electronPackageJsonPath = requireFromDesktop.resolve(
    "electron/package.json",
  );
  const electronPackageRoot = dirname(electronPackageJsonPath);

  return join(
    electronPackageRoot,
    "dist",
    "Electron.app",
    "Contents",
    "MacOS",
    "Electron",
  );
}

async function patchElectronLsuiElement(
  electronExecutablePath: string,
): Promise<void> {
  const electronAppPath = electronExecutablePath.replace(
    /\/Contents\/MacOS\/Electron$/u,
    "",
  );
  const infoPlistPath = join(electronAppPath, "Contents", "Info.plist");

  await access(infoPlistPath);

  let currentValue = "";

  try {
    const result = await execFileAsync("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :LSUIElement",
      infoPlistPath,
    ]);
    currentValue = result.stdout.trim();
  } catch {}

  if (currentValue === "true" || currentValue === "1") {
    return;
  }

  try {
    await execFileAsync("/usr/libexec/PlistBuddy", [
      "-c",
      "Set :LSUIElement true",
      infoPlistPath,
    ]);
  } catch {
    await execFileAsync("/usr/libexec/PlistBuddy", [
      "-c",
      "Add :LSUIElement bool true",
      infoPlistPath,
    ]);
  }

  try {
    await execFileAsync(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-f", electronAppPath],
    );
  } catch {
    // Fallback: Launch Services cache flush is best-effort on macOS dev machines.
  }
}

export async function createDarwinDesktopDevLaunchSpec(
  options: DarwinDesktopDevLaunchSpecOptions,
): Promise<DesktopDevLaunchSpec> {
  const electronExecutablePath = resolveElectronExecutablePath();
  await patchElectronLsuiElement(electronExecutablePath);

  return {
    command: options.command ?? "pnpm",
    args: options.args ?? ["exec", "electron", "apps/desktop"],
    cwd: options.cwd ?? repoRootPath,
    env: await resolveDesktopLaunchEnv(options.env),
  };
}

export async function findDarwinDesktopDevMainPid(
  _launchId?: string,
): Promise<number | undefined> {
  try {
    const result = await execFileAsync("ps", ["-axo", "pid=,ppid=,command="]);
    const parentPidText = result.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.includes(darwinDesktopUserDataArg))
      .map((line) => line.split(/\s+/, 3))
      .map((columns) => columns[1])
      .find(Boolean);

    if (!parentPidText) {
      return undefined;
    }

    const pid = Number(parentPidText);
    return Number.isNaN(pid) ? undefined : pid;
  } catch {
    return undefined;
  }
}

export async function terminateDarwinDesktopDevProcesses(
  pid?: number,
  options?: { force?: boolean },
): Promise<void> {
  const signal = options?.force ? "SIGKILL" : "SIGTERM";

  if (pid) {
    try {
      process.kill(pid, signal);
    } catch {}
  }

  try {
    const wrapperResult = await execFileAsync("pgrep", [
      "-f",
      darwinDesktopWrapperMatch,
    ]);
    const wrapperPids = wrapperResult.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((value) => Number(value))
      .filter((value) => !Number.isNaN(value));

    for (const wrapperPid of wrapperPids) {
      try {
        process.kill(wrapperPid, signal);
      } catch {}
    }
  } catch {}

  const detectedPid = await findDarwinDesktopDevMainPid();
  if (detectedPid) {
    try {
      process.kill(detectedPid, signal);
    } catch {}
  }
}
