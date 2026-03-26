/**
 * One-time state migration for v0.1.5 → v0.1.6 upgrade.
 * TODO: Remove this migration after v0.3+ when all users have upgraded past v0.1.6.
 *
 * v0.1.6 changed OPENCLAW_STATE_DIR from the Electron userData path
 * (`~/Library/Application Support/@nexu/desktop/runtime/openclaw/state/`)
 * to NEXU_HOME (`~/.nexu/runtime/openclaw/state/`).
 *
 * This broke session continuity — users lost historical conversations.
 * The hotfix restores userData as the canonical state dir and merges
 * any data created under ~/.nexu during the v0.1.6 window back.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";

const MIGRATION_STAMP = ".v016-migration-done";

/** Subdirectories inside openclaw state that contain user data worth migrating. */
const MERGEABLE_SUBDIRS = [
  "agents",
  "extensions",
  "identity",
  "feishu",
  "openclaw-weixin",
  "canvas",
  "devices",
  "plugin-docs",
  "skills",
] as const;

/** Top-level files inside openclaw state that should be copied if missing. */
const COPYABLE_FILES = [
  "nexu-runtime-model.json",
  "update-check.json",
] as const;

export interface StateMigrationOpts {
  /** Canonical state dir (userData-based), e.g. ~/Library/Application Support/@nexu/desktop/runtime/openclaw/state */
  targetStateDir: string;
  /** Stale state dir (nexuHome-based), e.g. ~/.nexu/runtime/openclaw/state */
  sourceStateDir: string;
  /** Logger */
  log: (message: string) => void;
}

/**
 * Migrate openclaw state created under ~/.nexu back to the userData-based path.
 *
 * Strategy:
 * - For each agent directory: if it exists in source but not target, copy it over.
 *   If the same agent exists in both, merge session files (source wins for files
 *   not present in target, target wins for conflicts).
 * - For other subdirs (extensions, identity, etc.): copy if not present in target.
 * - Idempotent: writes a stamp file after success so it only runs once.
 */
export function migrateOpenclawState(opts: StateMigrationOpts): void {
  const { targetStateDir, sourceStateDir, log } = opts;

  // Skip if already migrated
  const stampPath = join(targetStateDir, MIGRATION_STAMP);
  if (existsSync(stampPath)) {
    log("migration already completed, skipping");
    return;
  }

  // Skip if source doesn't exist or is empty
  if (!existsSync(sourceStateDir)) {
    log(`source not found: ${sourceStateDir}, nothing to migrate`);
    mkdirSync(targetStateDir, { recursive: true });
    writeStamp(stampPath);
    return;
  }

  // Ensure target exists
  mkdirSync(targetStateDir, { recursive: true });

  let migrated = 0;

  // Merge agent directories (most critical — contains sessions/conversations)
  const sourceAgentsDir = join(sourceStateDir, "agents");
  const targetAgentsDir = join(targetStateDir, "agents");
  if (existsSync(sourceAgentsDir)) {
    mkdirSync(targetAgentsDir, { recursive: true });
    const agentIds = safeReaddir(sourceAgentsDir);
    for (const agentId of agentIds) {
      const sourceAgent = join(sourceAgentsDir, agentId);
      const targetAgent = join(targetAgentsDir, agentId);

      if (!existsSync(targetAgent)) {
        // Agent only exists in source — copy entire directory
        log(`copying agent ${agentId} (not in target)`);
        cpSync(sourceAgent, targetAgent, { recursive: true });
        migrated++;
      } else {
        // Agent exists in both — merge session files
        migrated += mergeAgentSessions(sourceAgent, targetAgent, agentId, log);
      }
    }
  }

  // Copy other subdirectories if missing in target
  for (const subdir of MERGEABLE_SUBDIRS) {
    if (subdir === "agents") continue; // already handled above
    const sourceDir = join(sourceStateDir, subdir);
    const targetDir = join(targetStateDir, subdir);
    if (existsSync(sourceDir) && !existsSync(targetDir)) {
      log(`copying subdir ${subdir}`);
      cpSync(sourceDir, targetDir, { recursive: true });
      migrated++;
    }
  }

  // Copy top-level files if missing
  for (const file of COPYABLE_FILES) {
    const sourceFile = join(sourceStateDir, file);
    const targetFile = join(targetStateDir, file);
    if (existsSync(sourceFile) && !existsSync(targetFile)) {
      log(`copying file ${file}`);
      cpSync(sourceFile, targetFile);
      migrated++;
    }
  }

  writeStamp(stampPath);
  log(`migration complete: ${migrated} items migrated`);
}

/**
 * Merge session files from source agent into target agent.
 * Only copies files that don't already exist in target (no overwrites).
 */
function mergeAgentSessions(
  sourceAgent: string,
  targetAgent: string,
  agentId: string,
  log: (msg: string) => void,
): number {
  const sourceSessionsDir = join(sourceAgent, "sessions");
  const targetSessionsDir = join(targetAgent, "sessions");

  if (!existsSync(sourceSessionsDir)) {
    return 0;
  }

  mkdirSync(targetSessionsDir, { recursive: true });

  let count = 0;
  const sessionFiles = safeReaddir(sourceSessionsDir);

  for (const file of sessionFiles) {
    const sourceFile = join(sourceSessionsDir, file);
    const targetFile = join(targetSessionsDir, file);

    if (!existsSync(targetFile)) {
      cpSync(sourceFile, targetFile);
      count++;
    }
  }

  // Also copy agent-level files (IDENTITY.md, SOUL.md, etc.) if missing
  const agentLevelFiles = safeReaddir(sourceAgent);
  for (const file of agentLevelFiles) {
    if (file === "sessions" || file === ".openclaw") continue;
    const sourceFile = join(sourceAgent, file);
    const targetFile = join(targetAgent, file);
    if (!existsSync(targetFile)) {
      cpSync(sourceFile, targetFile, { recursive: true });
      count++;
    }
  }

  if (count > 0) {
    log(`merged ${count} files into agent ${agentId}`);
  }

  return count;
}

function writeStamp(stampPath: string): void {
  writeFileSync(stampPath, new Date().toISOString(), "utf-8");
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => !name.startsWith("."));
  } catch {
    return [];
  }
}

/**
 * Resolve the legacy v0.1.6 state dir path (nexuHome-based).
 */
export function getLegacyNexuHomeStateDir(nexuHome: string): string {
  const expanded = nexuHome.replace(/^~/, os.homedir());
  return resolve(expanded, "runtime", "openclaw", "state");
}
