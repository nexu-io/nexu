import type { CreateBotInput, UpdateBotInput } from "@nexu/shared";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

export class AgentService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
  ) {}

  async listBots() {
    return this.configStore.listBots();
  }

  async getBot(botId: string) {
    return this.configStore.getBot(botId);
  }

  async createBot(input: CreateBotInput) {
    const bot = await this.configStore.createBot(input);
    await this.syncService.syncAll();
    return bot;
  }

  async updateBot(botId: string, input: UpdateBotInput) {
    const bot = await this.configStore.updateBot(botId, input);
    if (bot !== null) {
      await this.syncService.syncAll();
    }
    return bot;
  }

  async deleteBot(botId: string) {
    const deleted = await this.configStore.deleteBot(botId);
    if (deleted) {
      await this.syncService.syncAll();
    }
    return deleted;
  }

  async pauseBot(botId: string) {
    const bot = await this.configStore.setBotStatus(botId, "paused");
    if (bot !== null) {
      await this.syncService.syncAll();
    }
    return bot;
  }

  async resumeBot(botId: string) {
    const bot = await this.configStore.setBotStatus(botId, "active");
    if (bot !== null) {
      await this.syncService.syncAll();
    }
    return bot;
  }
}
