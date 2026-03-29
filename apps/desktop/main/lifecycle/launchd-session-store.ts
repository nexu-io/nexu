import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  DesktopRuntimePortBindings,
  DesktopRuntimeSessionSnapshot,
} from "@nexu/shared";

export interface LaunchdRuntimeSessionMetadata {
  writtenAt: string;
  electronPid: number;
  controllerPort: number;
  openclawPort: number;
  webPort: number;
  nexuHome: string;
  isDev: boolean;
  appVersion?: string;
  openclawStateDir?: string;
  userDataPath?: string;
  buildSource?: string;
}

export function getLaunchdRuntimeSessionPath(plistDir: string): string {
  return path.join(plistDir, "runtime-ports.json");
}

export async function writeLaunchdRuntimeSession(
  plistDir: string,
  meta: LaunchdRuntimeSessionMetadata,
): Promise<void> {
  const sessionPath = getLaunchdRuntimeSessionPath(plistDir);
  const tmpPath = `${sessionPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(meta, null, 2), "utf8");
  await fs.rename(tmpPath, sessionPath);
}

export async function readLaunchdRuntimeSession(
  plistDir: string,
): Promise<LaunchdRuntimeSessionMetadata | null> {
  try {
    const raw = await fs.readFile(
      getLaunchdRuntimeSessionPath(plistDir),
      "utf8",
    );
    return JSON.parse(raw) as LaunchdRuntimeSessionMetadata;
  } catch {
    return null;
  }
}

export async function deleteLaunchdRuntimeSession(
  plistDir: string,
): Promise<void> {
  try {
    await fs.unlink(getLaunchdRuntimeSessionPath(plistDir));
  } catch {
    // best effort
  }
}

export function getLaunchdRuntimePortBindings(
  meta: LaunchdRuntimeSessionMetadata,
): DesktopRuntimePortBindings {
  return {
    controllerPort: meta.controllerPort,
    openclawPort: meta.openclawPort,
    webPort: meta.webPort,
  };
}

export function toLaunchdRuntimeSessionSnapshot(
  meta: LaunchdRuntimeSessionMetadata,
): DesktopRuntimeSessionSnapshot {
  return {
    platformId: "mac",
    residency: "launchd",
    transition: "attached",
    store: "runtime-ports-file",
    bindings: getLaunchdRuntimePortBindings(meta),
  };
}
