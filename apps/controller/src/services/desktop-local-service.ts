import type { NexuConfigStore } from "../store/nexu-config-store.js";

export class DesktopLocalService {
  constructor(private readonly configStore: NexuConfigStore) {}

  async getCloudStatus() {
    return this.configStore.getDesktopCloudStatus();
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

  async getLinkCatalog() {
    const status = await this.configStore.getDesktopCloudStatus();
    const grouped = new Map<
      string,
      Array<{
        id: string;
        name: string;
        externalName: string;
        inputPrice: null;
        outputPrice: null;
      }>
    >();
    for (const model of status.models ?? []) {
      const provider = model.provider ?? "nexu";
      const current = grouped.get(provider) ?? [];
      current.push({
        id: model.id,
        name: model.name,
        externalName: model.id,
        inputPrice: null,
        outputPrice: null,
      });
      grouped.set(provider, current);
    }

    return {
      providers: Array.from(grouped.entries()).map(([id, models]) => ({
        id,
        name: id,
        kind: id,
        models,
      })),
    };
  }
}
