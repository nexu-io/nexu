import { cp, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";

export class OpenClawRuntimePluginWriter {
  constructor(private readonly env: ControllerEnv) {}

  async ensurePlugins(): Promise<void> {
    await mkdir(this.env.openclawExtensionsDir, { recursive: true });

    const entries = await readdir(this.env.runtimePluginTemplatesDir, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sourceDir = path.join(
        this.env.runtimePluginTemplatesDir,
        entry.name,
      );
      const targetDir = path.join(this.env.openclawExtensionsDir, entry.name);
      await cp(sourceDir, targetDir, { recursive: true, force: true });
    }
  }
}
