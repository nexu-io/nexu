import { readFile } from "node:fs/promises";
import type { ControllerEnv } from "../app/env.js";

type RuntimeModelState = {
  selectedModelRef?: string;
};

export class RuntimeModelStateService {
  constructor(private readonly env: ControllerEnv) {}

  async getEffectiveModelId(): Promise<string | null> {
    try {
      const raw = await readFile(
        this.env.openclawRuntimeModelStatePath,
        "utf8",
      );
      const parsed = JSON.parse(raw) as RuntimeModelState;
      return typeof parsed.selectedModelRef === "string" &&
        parsed.selectedModelRef.length > 0
        ? parsed.selectedModelRef
        : null;
    } catch {
      return null;
    }
  }
}
