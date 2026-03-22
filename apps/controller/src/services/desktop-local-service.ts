import type { OpenClawProcessManager } from "../runtime/openclaw-process.js";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { ModelProviderService } from "./model-provider-service.js";

export class DesktopLocalService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly modelProviderService: ModelProviderService,
    private readonly openclawProcess: OpenClawProcessManager,
  ) {}

  async getCloudStatus() {
    return this.configStore.getDesktopCloudStatus();
  }

  async refreshCloudStatus() {
    const before = await this.modelProviderService.getInventoryStatus();
    const status = await this.configStore.refreshDesktopCloudModels();
    const after = await this.modelProviderService.getInventoryStatus();
    return {
      ...status,
      firstInventoryActivated:
        !before.hasKnownInventory && after.hasKnownInventory,
    };
  }

  async connectCloud() {
    return this.configStore.connectDesktopCloud();
  }

  async disconnectCloud() {
    return this.configStore.disconnectDesktopCloud();
  }

  async setCloudModels(enabledModelIds: string[]) {
    const before = await this.modelProviderService.getInventoryStatus();
    const result =
      await this.configStore.setDesktopCloudModels(enabledModelIds);
    const after = await this.modelProviderService.getInventoryStatus();
    return {
      ...result,
      firstInventoryActivated:
        !before.hasKnownInventory && after.hasKnownInventory,
    };
  }

  async setDefaultModel(modelId: string) {
    await this.configStore.setDefaultModel(modelId);
    return { ok: true, modelId };
  }

  async restartRuntime(): Promise<void> {
    await this.openclawProcess.stop();
    this.openclawProcess.enableAutoRestart();
    this.openclawProcess.start();
  }
}
