import { cp, mkdir, readdir } from "node:fs/promises";
import path, { basename } from "node:path";
import type { ControllerEnv } from "../app/env.js";

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
        dereference: true,
        filter: (source) => basename(source) !== ".bin",
      });
    }
  }
}
