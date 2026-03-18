import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";

export class OpenClawConfigWriter {
  constructor(private readonly env: ControllerEnv) {}

  async write(config: OpenClawConfig): Promise<void> {
    await mkdir(path.dirname(this.env.openclawConfigPath), { recursive: true });
    const tempPath = `${this.env.openclawConfigPath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await rename(tempPath, this.env.openclawConfigPath);
  }
}
