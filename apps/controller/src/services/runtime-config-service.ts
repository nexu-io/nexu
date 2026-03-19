import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { ControllerRuntimeConfig } from "../store/schemas.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

export class RuntimeConfigService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
  ) {}

  async getRuntimeConfig(): Promise<ControllerRuntimeConfig> {
    return this.configStore.getRuntimeConfig();
  }

  async setRuntimeConfig(
    runtime: ControllerRuntimeConfig,
  ): Promise<ControllerRuntimeConfig> {
    const next = await this.configStore.setRuntimeConfig(runtime);
    await this.syncService.syncAll();
    return next;
  }
}
