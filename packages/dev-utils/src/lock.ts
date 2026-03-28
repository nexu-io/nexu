import { readFile, rm, writeFile } from "node:fs/promises";

import { ensureParentDirectory } from "./paths.js";

export type DevLock = {
  pid: number;
  runId: string;
  sessionId?: string;
  launchId?: string;
};

export async function writeDevLock(
  lockPath: string,
  lock: DevLock,
): Promise<void> {
  await ensureParentDirectory(lockPath);
  await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

export async function removeDevLock(lockPath: string): Promise<void> {
  await rm(lockPath, { force: true });
}

export async function readDevLock(lockPath: string): Promise<DevLock> {
  const content = await readFile(lockPath, "utf8");
  return JSON.parse(content) as DevLock;
}
