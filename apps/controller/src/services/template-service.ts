import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

export class TemplateService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
  ) {}

  async listTemplates() {
    return {
      templates: await this.configStore.listTemplates(),
    };
  }

  async getLatestRuntimeSnapshot() {
    return this.configStore.getRuntimeTemplatesSnapshot();
  }

  async upsertTemplate(input: {
    name: string;
    content: string;
    writeMode?: "seed" | "inject";
    status?: "active" | "inactive";
  }) {
    const template = await this.configStore.upsertTemplate(input);
    await this.syncService.syncAll();
    return {
      ok: true,
      name: template.name,
      version: (await this.configStore.listTemplates()).length,
    };
  }
}
