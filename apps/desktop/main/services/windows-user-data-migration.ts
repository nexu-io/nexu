import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import type { PendingUserDataMigrationContext } from "../platforms/types";

const WINDOWS_CONFIG_REGKEY = "HKCU\\Software\\Nexu\\Desktop";
const USER_DATA_ROOT_VALUE = "UserDataRoot";
const PENDING_SOURCE_VALUE = "PendingUserDataMigrationSource";
const PENDING_TARGET_VALUE = "PendingUserDataMigrationTarget";
const PENDING_STRATEGY_VALUE = "PendingUserDataMigrationStrategy";

interface ExecuteWindowsUserDataMigrationOpts {
  pending: PendingUserDataMigrationContext;
  currentTargetDir: string;
  log: (message: string) => void;
}

export interface ExecuteWindowsUserDataMigrationResult {
  pendingConsumed: boolean;
  migrated: boolean;
  sourceDir: string;
  targetDir: string;
  strategy: PendingUserDataMigrationContext["strategy"];
}

function readRegistryValues(): Record<string, string> {
  try {
    const output = execFileSync("reg.exe", ["query", WINDOWS_CONFIG_REGKEY], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    });

    const values: Record<string, string> = {};
    for (const line of output.split(/\r?\n/u)) {
      const match = line.match(/^\s*([^\s]+)\s+REG_\w+\s+(.+)$/u);
      if (match?.[1] && match[2]) {
        values[match[1].trim()] = match[2].trim();
      }
    }
    return values;
  } catch {
    return {};
  }
}

function deleteRegistryValue(name: string): void {
  try {
    execFileSync(
      "reg.exe",
      ["delete", WINDOWS_CONFIG_REGKEY, "/v", name, "/f"],
      {
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true,
      },
    );
  } catch {}
}

function clearPendingMigrationRegistryValues(): void {
  deleteRegistryValue(PENDING_SOURCE_VALUE);
  deleteRegistryValue(PENDING_TARGET_VALUE);
  deleteRegistryValue(PENDING_STRATEGY_VALUE);
}

export function readPendingWindowsUserDataMigration(): PendingUserDataMigrationContext | null {
  const values = readRegistryValues();
  const sourceDir = values[PENDING_SOURCE_VALUE];
  const targetDir = values[PENDING_TARGET_VALUE];
  const strategyValue = values[PENDING_STRATEGY_VALUE];

  if (!sourceDir || !targetDir || !strategyValue) {
    if (sourceDir || targetDir || strategyValue) {
      clearPendingMigrationRegistryValues();
    }
    return null;
  }

  if (
    strategyValue !== "move" &&
    strategyValue !== "copy" &&
    strategyValue !== "noop"
  ) {
    clearPendingMigrationRegistryValues();
    return null;
  }

  return {
    sourceDir: resolve(sourceDir),
    targetDir: resolve(targetDir),
    strategy: strategyValue,
  };
}

function isDirectoryEmpty(path: string): boolean {
  if (!existsSync(path)) {
    return true;
  }

  try {
    return readdirSync(path).length === 0;
  } catch {
    return false;
  }
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function isNestedPath(parentPath: string, childPath: string): boolean {
  const normalizedParent = resolve(parentPath);
  const normalizedChild = resolve(childPath);
  return normalizedChild.startsWith(`${normalizedParent}\\`);
}

function copyMissingRecursive(sourceDir: string, targetDir: string): void {
  ensureDir(targetDir);

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = resolve(sourceDir, entry.name);
    const targetPath = resolve(targetDir, entry.name);

    if (existsSync(targetPath)) {
      if (entry.isDirectory()) {
        copyMissingRecursive(sourcePath, targetPath);
      }
      continue;
    }

    cpSync(sourcePath, targetPath, { recursive: true });
  }
}

function executeMoveMigration(sourceDir: string, targetDir: string): string {
  ensureDir(dirname(targetDir));

  if (isDirectoryEmpty(targetDir)) {
    try {
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      renameSync(sourceDir, targetDir);
      return "move strategy completed via rename";
    } catch {
      ensureDir(targetDir);
    }
  }

  copyMissingRecursive(sourceDir, targetDir);
  rmSync(sourceDir, { recursive: true, force: true });
  return "move strategy completed via copy fallback";
}

export function clearPendingWindowsUserDataMigration(): void {
  clearPendingMigrationRegistryValues();
}

export function executeWindowsUserDataMigration(
  opts: ExecuteWindowsUserDataMigrationOpts,
): ExecuteWindowsUserDataMigrationResult {
  const { pending, log } = opts;
  const currentTargetDir = resolve(opts.currentTargetDir);

  const result: ExecuteWindowsUserDataMigrationResult = {
    pendingConsumed: false,
    migrated: false,
    sourceDir: pending.sourceDir,
    targetDir: pending.targetDir,
    strategy: pending.strategy,
  };

  try {
    if (pending.targetDir !== currentTargetDir) {
      log(
        `pending migration target mismatch current=${currentTargetDir} pending=${pending.targetDir}; clearing`,
      );
      clearPendingMigrationRegistryValues();
      result.pendingConsumed = true;
      return result;
    }

    if (pending.strategy === "noop") {
      log("pending migration strategy=noop; clearing");
      clearPendingMigrationRegistryValues();
      result.pendingConsumed = true;
      return result;
    }

    if (pending.sourceDir === pending.targetDir) {
      log("pending migration source equals target; clearing");
      clearPendingMigrationRegistryValues();
      result.pendingConsumed = true;
      return result;
    }

    if (!existsSync(pending.sourceDir) || isDirectoryEmpty(pending.sourceDir)) {
      log(
        `pending migration source missing or empty: ${pending.sourceDir}; clearing`,
      );
      clearPendingMigrationRegistryValues();
      result.pendingConsumed = true;
      return result;
    }

    if (
      isNestedPath(pending.sourceDir, pending.targetDir) ||
      isNestedPath(pending.targetDir, pending.sourceDir)
    ) {
      log(
        `pending migration skipped due to overlapping paths source=${pending.sourceDir} target=${pending.targetDir}`,
      );
      clearPendingMigrationRegistryValues();
      result.pendingConsumed = true;
      return result;
    }

    ensureDir(pending.targetDir);

    if (pending.strategy === "copy") {
      copyMissingRecursive(pending.sourceDir, pending.targetDir);
      log(
        `copy strategy completed source=${pending.sourceDir} target=${pending.targetDir}`,
      );
      clearPendingMigrationRegistryValues();
      result.pendingConsumed = true;
      result.migrated = true;
      return result;
    }

    const moveResult = executeMoveMigration(
      pending.sourceDir,
      pending.targetDir,
    );
    log(
      `${moveResult} source=${pending.sourceDir} target=${pending.targetDir}`,
    );
    clearPendingMigrationRegistryValues();
    return {
      ...result,
      pendingConsumed: true,
      migrated: true,
      sourceDir: pending.sourceDir,
      targetDir: pending.targetDir,
      strategy: pending.strategy,
    };
  } catch (error) {
    log(
      `pending migration failed source=${pending.sourceDir} target=${pending.targetDir} strategy=${pending.strategy} error=${error instanceof Error ? error.message : String(error)}`,
    );
    return result;
  }
}

export function readWindowsRegistryUserDataRoot(): string | null {
  const values = readRegistryValues();
  const userDataRoot = values[USER_DATA_ROOT_VALUE];
  return userDataRoot ? resolve(userDataRoot) : null;
}
