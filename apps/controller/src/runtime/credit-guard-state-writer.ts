import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ControllerEnv } from "../app/env.js";

export class CreditGuardStateWriter {
  constructor(private readonly env: ControllerEnv) {}

  async write(locale: "en" | "zh-CN"): Promise<void> {
    await mkdir(path.dirname(this.env.creditGuardStatePath), {
      recursive: true,
    });
    await writeFile(
      this.env.creditGuardStatePath,
      `${JSON.stringify({ locale, updatedAt: new Date().toISOString() }, null, 2)}\n`,
      "utf8",
    );
  }
}
