import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  type ExecuteWindowsUserDataMigrationResult,
  executeWindowsUserDataMigration,
} from "../../services/windows-user-data-migration";
import type { DesktopRuntimeStateMigrationPolicy } from "../types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSubPath(parentPath: string, childPath: string): boolean {
  const normalizedParent = resolve(parentPath);
  const normalizedChild = resolve(childPath);
  const relativePath = relative(normalizedParent, normalizedChild);
  return (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  );
}

function isAgentSessionTranscriptRelativePath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]+/u).filter(Boolean);
  const fileName = segments.at(-1) ?? "";
  return (
    segments.length === 7 &&
    segments[0] === "runtime" &&
    segments[1] === "openclaw" &&
    segments[2] === "state" &&
    segments[3] === "agents" &&
    segments[5] === "sessions" &&
    fileName.endsWith(".jsonl")
  );
}

function remapSessionFilePath(
  sessionFilePath: string,
  sourceUserDataDir: string,
  targetUserDataDir: string,
): string | null {
  if (!isAbsolute(sessionFilePath)) {
    return null;
  }

  const resolvedSessionFilePath = resolve(sessionFilePath);
  if (!isSubPath(sourceUserDataDir, resolvedSessionFilePath)) {
    return null;
  }

  const sourceRelativePath = relative(
    sourceUserDataDir,
    resolvedSessionFilePath,
  );
  if (!isAgentSessionTranscriptRelativePath(sourceRelativePath)) {
    return null;
  }

  return resolve(targetUserDataDir, sourceRelativePath);
}

function repairMigratedOpenclawSessionFiles(
  migration: ExecuteWindowsUserDataMigrationResult,
  log: (message: string) => void,
): void {
  const agentsRoot = join(
    migration.targetDir,
    "runtime",
    "openclaw",
    "state",
    "agents",
  );

  if (!existsSync(agentsRoot)) {
    log(
      `windows-user-data-migration: aftercare skipped agentsRootMissing=${agentsRoot}`,
    );
    return;
  }

  let repairedFiles = 0;
  let repairedEntries = 0;

  for (const entry of readdirSync(agentsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const sessionsIndexPath = join(
      agentsRoot,
      entry.name,
      "sessions",
      "sessions.json",
    );
    if (!existsSync(sessionsIndexPath)) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(sessionsIndexPath, "utf8"));
    } catch (error) {
      log(
        `windows-user-data-migration: aftercare skipped invalidJson path=${sessionsIndexPath} error=${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (!isPlainObject(parsed)) {
      log(
        `windows-user-data-migration: aftercare skipped nonObjectIndex path=${sessionsIndexPath}`,
      );
      continue;
    }

    let fileChanged = false;

    for (const [sessionKey, sessionValue] of Object.entries(parsed)) {
      if (!isPlainObject(sessionValue)) {
        continue;
      }

      const sessionFile = sessionValue.sessionFile;
      if (typeof sessionFile !== "string") {
        continue;
      }

      const remappedSessionFile = remapSessionFilePath(
        sessionFile,
        migration.sourceDir,
        migration.targetDir,
      );
      if (!remappedSessionFile || remappedSessionFile === sessionFile) {
        continue;
      }

      sessionValue.sessionFile = remappedSessionFile;
      fileChanged = true;
      repairedEntries += 1;
      log(
        `windows-user-data-migration: aftercare remapped sessionFile key=${sessionKey} path=${sessionsIndexPath}`,
      );
    }

    if (!fileChanged) {
      continue;
    }

    writeFileSync(
      sessionsIndexPath,
      `${JSON.stringify(parsed, null, 2)}\n`,
      "utf8",
    );
    repairedFiles += 1;
  }

  log(
    `windows-user-data-migration: aftercare repaired sessionFiles files=${repairedFiles} entries=${repairedEntries}`,
  );
}

export function createWindowsStateMigrationPolicy(): DesktopRuntimeStateMigrationPolicy {
  return {
    run({ isPackaged, log, pendingUserDataMigration, runtimeRoots }) {
      if (!isPackaged || !pendingUserDataMigration) {
        return;
      }

      const migrationResult = executeWindowsUserDataMigration({
        pending: pendingUserDataMigration,
        currentTargetDir: runtimeRoots.userDataRoot,
        log: (message) => log(`windows-user-data-migration: ${message}`),
      });

      if (migrationResult.pendingConsumed && migrationResult.migrated) {
        repairMigratedOpenclawSessionFiles(migrationResult, log);
      }
    },
  };
}
