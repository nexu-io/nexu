import type { OpenClawConfig } from "@nexu/shared";
import type { ControllerEnv } from "../app/env.js";
import { LowDbStore } from "./lowdb-store.js";
import { compiledOpenClawSnapshotSchema } from "./schemas.js";

export class CompiledOpenClawStore {
  private readonly store: LowDbStore<{
    updatedAt: string;
    config: Record<string, unknown>;
  }>;

  constructor(env: ControllerEnv) {
    this.store = new LowDbStore(
      env.compiledOpenclawSnapshotPath,
      compiledOpenClawSnapshotSchema,
      () => ({
        updatedAt: new Date(0).toISOString(),
        config: {},
      }),
    );
  }

  async saveConfig(config: OpenClawConfig): Promise<void> {
    await this.store.write({
      updatedAt: new Date().toISOString(),
      config,
    });
  }

  async readConfig(): Promise<Record<string, unknown>> {
    const snapshot = await this.store.read();
    return snapshot.config;
  }
}
