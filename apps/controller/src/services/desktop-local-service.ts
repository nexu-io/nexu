import type { NexuConfigStore } from "../store/nexu-config-store.js";

export class DesktopLocalService {
  constructor(private readonly configStore: NexuConfigStore) {}

  async getCloudStatus() {
    return this.configStore.getDesktopCloudStatus();
  }

  async refreshCloudStatus() {
    return this.configStore.refreshDesktopCloudModels();
  }

  async connectCloud() {
    return this.configStore.connectDesktopCloud();
  }

  async disconnectCloud() {
    return this.configStore.disconnectDesktopCloud();
  }

  async setCloudModels(enabledModelIds: string[]) {
    return this.configStore.setDesktopCloudModels(enabledModelIds);
  }

  async setDefaultModel(modelId: string) {
    await this.configStore.setDefaultModel(modelId);
    return { ok: true, modelId };
  }
}
