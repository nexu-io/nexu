import { appendFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";

export class OpenClawWatchTrigger {
  constructor(private readonly env: ControllerEnv) {}

  async touchConfig(): Promise<void> {
    await this.touchFile(this.env.openclawConfigPath);
  }

  async touchSkill(slug: string): Promise<void> {
    await this.touchFile(
      path.join(this.env.openclawSkillsDir, slug, "SKILL.md"),
    );
  }

  private async touchFile(filePath: string): Promise<void> {
    try {
      await appendFile(filePath, "", "utf8");
    } catch {
      return;
    }
  }
}
