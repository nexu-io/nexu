import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

export class SkillService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
  ) {}

  async getSkills() {
    return this.configStore.getSkills();
  }

  async getLatestRuntimeSnapshot() {
    return this.configStore.getRuntimeSkillsSnapshot();
  }

  async upsertSkill(input: {
    name: string;
    content: string;
    files?: Record<string, string>;
    status?: "active" | "inactive";
  }) {
    const result = await this.configStore.upsertSkill(input);
    await this.syncService.syncAll();
    return result;
  }
}
