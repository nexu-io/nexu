import type {
  BotQuotaResponse,
  ChannelResponse,
  ConnectDiscordInput,
  ConnectFeishuInput,
  ConnectSlackInput,
} from "@nexu/shared";
import type { NexuConfigStore } from "../store/nexu-config-store.js";
import type { OpenClawSyncService } from "./openclaw-sync-service.js";

function timeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

export class ChannelService {
  constructor(
    private readonly configStore: NexuConfigStore,
    private readonly syncService: OpenClawSyncService,
  ) {}

  async listChannels() {
    return this.configStore.listChannels();
  }

  async getChannel(channelId: string): Promise<ChannelResponse | null> {
    return this.configStore.getChannel(channelId);
  }

  async getBotQuota(): Promise<BotQuotaResponse> {
    return {
      available: true,
      resetsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  async connectSlack(input: ConnectSlackInput) {
    const authResp = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${input.botToken}` },
      signal: timeoutSignal(5000),
    });
    const authData = (await authResp.json()) as {
      ok: boolean;
      team_id?: string;
      team?: string;
      bot_id?: string;
      user_id?: string;
      error?: string;
    };
    if (!authData.ok || !authData.team_id) {
      throw new Error(
        `Invalid Slack bot token: ${authData.error ?? "auth.test failed"}`,
      );
    }

    let appId = input.appId;
    if (!appId && authData.bot_id) {
      const botInfoResp = await fetch(
        `https://slack.com/api/bots.info?bot=${authData.bot_id}`,
        {
          headers: { Authorization: `Bearer ${input.botToken}` },
          signal: timeoutSignal(5000),
        },
      );
      const botInfo = (await botInfoResp.json()) as {
        ok: boolean;
        bot?: { app_id?: string };
      };
      appId = botInfo.bot?.app_id;
    }

    if (!appId) {
      throw new Error("Could not resolve Slack app id from bot token");
    }

    const channel = await this.configStore.connectSlack({
      ...input,
      teamId: input.teamId ?? authData.team_id,
      teamName: input.teamName ?? authData.team,
      appId,
      botUserId: authData.user_id ?? null,
    });
    await this.syncService.syncAll();
    return channel;
  }

  async connectDiscord(input: ConnectDiscordInput) {
    const userResp = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${input.botToken}` },
      signal: timeoutSignal(5000),
    });
    if (!userResp.ok) {
      throw new Error(
        userResp.status === 401
          ? "Invalid Discord bot token"
          : `Discord API error (${userResp.status})`,
      );
    }

    const userData = (await userResp.json()) as { id?: string };

    const appResp = await fetch(
      "https://discord.com/api/v10/applications/@me",
      {
        headers: { Authorization: `Bot ${input.botToken}` },
        signal: timeoutSignal(5000),
      },
    );
    if (appResp.ok) {
      const appData = (await appResp.json()) as { id: string };
      if (appData.id !== input.appId) {
        throw new Error(
          `Application ID mismatch: token belongs to ${appData.id}, but ${input.appId} was provided`,
        );
      }
    }

    const channel = await this.configStore.connectDiscord({
      ...input,
      botUserId: userData.id ?? null,
    });
    await this.syncService.syncAll();
    return channel;
  }

  async connectFeishu(input: ConnectFeishuInput) {
    const response = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_id: input.appId,
          app_secret: input.appSecret,
        }),
        signal: timeoutSignal(5000),
      },
    );
    const payload = (await response.json()) as { code?: number; msg?: string };
    if (!response.ok || payload.code !== 0) {
      throw new Error(
        `Invalid Feishu credentials: ${payload.msg ?? `HTTP ${response.status}`}`,
      );
    }

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
