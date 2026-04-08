import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const MIGRATION_STAMP = ".desktop-userdata-home-migration-v1";

const COPYABLE_FILES = [
  "cloud-profiles.json",
  "compiled-openclaw.json",
  "skill-ledger.json",
  "analytics-state.json",
] as const;

const COPYABLE_DIRS = [
  "artifacts",
  "skillhub-cache",
  "logs",
  "runtime",
] as const;

type JsonRecord = Record<string, unknown>;

export interface NexuHomeMigrationOpts {
  targetNexuHome: string;
  sourceNexuHome: string;
  log: (message: string) => void;
}

function safeReadJson(filePath: string): JsonRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as JsonRecord;
  } catch {
    return null;
  }
}

function mergeRecords(
  target: JsonRecord | undefined,
  source: JsonRecord | undefined,
): JsonRecord {
  return {
    ...(target ?? {}),
    ...(source ?? {}),
  };
}

function mergeConfigArrays(
  target: unknown,
  source: unknown,
): Array<Record<string, unknown>> | undefined {
  const targetItems = Array.isArray(target) ? target : [];
  const sourceItems = Array.isArray(source) ? source : [];
  if (targetItems.length === 0 && sourceItems.length === 0) {
    return undefined;
  }

  const merged = new Map<string, Record<string, unknown>>();
  const anon: Array<Record<string, unknown>> = [];
  for (const item of targetItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    if (id) {
      merged.set(id, record);
    } else {
      anon.push(record);
    }
  }

  for (const item of sourceItems) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : null;
    if (id) {
      merged.set(id, {
        ...(merged.get(id) ?? {}),
        ...record,
      });
    } else {
      anon.push(record);
    }
  }

  return [...merged.values(), ...anon];
}

function mergeNexuConfig(
  target: JsonRecord | null,
  source: JsonRecord | null,
): JsonRecord | null {
  if (!target && !source) return null;
  if (!target) return source;
  if (!source) return target;

  return {
    ...target,
    ...source,
    app: mergeRecords(
      target.app as JsonRecord | undefined,
      source.app as JsonRecord | undefined,
    ),
    runtime: mergeRecords(
      target.runtime as JsonRecord | undefined,
      source.runtime as JsonRecord | undefined,
    ),
    desktop: mergeRecords(
      target.desktop as JsonRecord | undefined,
      source.desktop as JsonRecord | undefined,
    ),
    secrets: mergeRecords(
      target.secrets as JsonRecord | undefined,
      source.secrets as JsonRecord | undefined,
    ),
    templates: mergeRecords(
      target.templates as JsonRecord | undefined,
      source.templates as JsonRecord | undefined,
    ),
    bots: mergeConfigArrays(target.bots, source.bots) ?? [],
    providers: mergeConfigArrays(target.providers, source.providers) ?? [],
    integrations:
      mergeConfigArrays(target.integrations, source.integrations) ?? [],
    channels: mergeConfigArrays(target.channels, source.channels) ?? [],
  };
}

function copyDirIfMissing(
  sourceDir: string,
  targetDir: string,
  log: (message: string) => void,
): number {
  if (!existsSync(sourceDir) || existsSync(targetDir)) {
    return 0;
  }
  cpSync(sourceDir, targetDir, { recursive: true });
  log(`copied dir ${targetDir}`);
  return 1;
}

function copyFileIfMissing(
  sourceFile: string,
  targetFile: string,
  log: (message: string) => void,
): number {
  if (!existsSync(sourceFile) || existsSync(targetFile)) {
    return 0;
  }
  cpSync(sourceFile, targetFile);
  log(`copied file ${targetFile}`);
  return 1;
}

function writeStamp(stampPath: string): void {
  writeFileSync(stampPath, new Date().toISOString(), "utf8");
}

export function getLegacyPackagedNexuHomeDir(userDataPath: string): string {
  return resolve(userDataPath, ".nexu");
}

export function migrateNexuHomeFromUserData(opts: NexuHomeMigrationOpts): void {
  const { targetNexuHome, sourceNexuHome, log } = opts;
  const stampPath = resolve(targetNexuHome, MIGRATION_STAMP);

  if (existsSync(stampPath)) {
    log("nexu-home migration already completed, skipping");
    return;
  }

  mkdirSync(targetNexuHome, { recursive: true });

  if (!existsSync(sourceNexuHome)) {
    log(`legacy nexu-home not found: ${sourceNexuHome}, nothing to migrate`);
    writeStamp(stampPath);
    return;
  }

  let migrated = 0;

  const sourceConfigPath = resolve(sourceNexuHome, "config.json");
  const targetConfigPath = resolve(targetNexuHome, "config.json");
  const mergedConfig = mergeNexuConfig(
    safeReadJson(targetConfigPath),
    safeReadJson(sourceConfigPath),
  );
  if (mergedConfig) {
    writeFileSync(
      targetConfigPath,
      `${JSON.stringify(mergedConfig, null, 2)}\n`,
      "utf8",
    );
    log(`merged config ${targetConfigPath}`);
    migrated++;
  }

  for (const file of COPYABLE_FILES) {
    migrated += copyFileIfMissing(
      resolve(sourceNexuHome, file),
      resolve(targetNexuHome, file),
      log,
    );
  }

  for (const dir of COPYABLE_DIRS) {
    migrated += copyDirIfMissing(
      resolve(sourceNexuHome, dir),
      resolve(targetNexuHome, dir),
      log,
    );
  }

  writeStamp(stampPath);
  log(`nexu-home migration complete: ${migrated} items migrated`);
}
