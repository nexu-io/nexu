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

  async connectCloudProfile(name: string) {
    return this.configStore.connectDesktopCloudProfile(name);
  }

  async disconnectCloud() {
    return this.configStore.disconnectDesktopCloud();
  }

  async disconnectCloudProfile(name: string) {
    return this.configStore.disconnectDesktopCloudProfile(name);
  }

  async importCloudProfiles(
    profiles: Array<{ name: string; cloudUrl: string; linkUrl: string }>,
  ) {
    return this.configStore.setDesktopCloudProfiles(profiles);
  }

  async createCloudProfile(profile: {
    name: string;
    cloudUrl: string;
    linkUrl: string;
  }) {
    return this.configStore.createDesktopCloudProfile(profile);
  }

  async switchCloudProfile(name: string) {
    return this.configStore.switchDesktopCloudProfile(name);
  }

  async updateCloudProfile(
    previousName: string,
    profile: { name: string; cloudUrl: string; linkUrl: string },
  ) {
    return this.configStore.updateDesktopCloudProfile(previousName, profile);
  }

  async deleteCloudProfile(name: string) {
    return this.configStore.deleteDesktopCloudProfile(name);
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
