import type {
  ConnectDiscordInput,
  ConnectFeishuInput,
  ConnectSlackInput,
} from "@nexu/shared";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

export class ChannelService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
  ) {}

  async listChannels() {
    return this.configStore.listChannels();
  }

  async connectSlack(input: ConnectSlackInput) {
    const channel = await this.configStore.connectSlack(input);
    await this.syncService.syncAll();
    return channel;
  }

  async connectDiscord(input: ConnectDiscordInput) {
    const channel = await this.configStore.connectDiscord(input);
    await this.syncService.syncAll();
    return channel;
  }

  async connectFeishu(input: ConnectFeishuInput) {
    const channel = await this.configStore.connectFeishu(input);
    await this.syncService.syncAll();
    return channel;
  }

  async disconnectChannel(channelId: string) {
    const removed = await this.configStore.disconnectChannel(channelId);
    if (removed) {
      await this.syncService.syncAll();
    }
    return removed;
  }
}
