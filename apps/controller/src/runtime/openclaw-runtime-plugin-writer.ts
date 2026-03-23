import { cp, lstat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";

/**
 * Check whether a path is a symlink. Returns false if the path does not exist.
 */
async function isSymlink(p: string): Promise<boolean> {
  try {
    const stat = await lstat(p);
    return stat.isSymbolicLink();
  } catch {
    return false;
  }
}

async function shouldCopyPluginPath(sourcePath: string): Promise<boolean> {
  if (path.basename(sourcePath) !== ".bin") {
    return true;
  }

  return !(await isSymlink(sourcePath));
}

export class OpenClawRuntimePluginWriter {
  constructor(private readonly env: ControllerEnv) {}

  async ensurePlugins(): Promise<void> {
    await mkdir(this.env.openclawExtensionsDir, { recursive: true });

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(this.env.runtimePluginTemplatesDir, {
        withFileTypes: true,
      });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourceDir = path.join(
        this.env.runtimePluginTemplatesDir,
        entry.name,
      );
      const targetDir = path.join(this.env.openclawExtensionsDir, entry.name);
      await cp(sourceDir, targetDir, {
        recursive: true,
        force: true,
        filter: shouldCopyPluginPath,
      });
    }
  }
}
