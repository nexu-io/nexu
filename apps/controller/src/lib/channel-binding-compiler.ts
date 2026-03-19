import type {
  BindingConfig,
  DiscordAccountConfig,
  FeishuAccountConfig,
  OpenClawConfig,
  SlackAccountConfig,
} from "@nexu/shared";
import type { BotResponse, ChannelResponse } from "@nexu/shared";

function buildSecretLookup(secrets: Record<string, string>, channelId: string) {
  return (suffix: string): string =>
    secrets[`channel:${channelId}:${suffix}`] ?? "";
}

export function compileChannelBindings(
  bots: BotResponse[],
  channels: ChannelResponse[],
): BindingConfig[] {
  const activeBots = new Set(
    bots.filter((bot) => bot.status === "active").map((bot) => bot.id),
  );

  return channels
    .filter(
      (channel) =>
        channel.status === "connected" && activeBots.has(channel.botId),
    )
    .map((channel) => ({
      agentId: channel.botId,
      match: {
        channel: channel.channelType,
        accountId: channel.accountId,
      },
    }));
}

export function compileChannelsConfig(params: {
  channels: ChannelResponse[];
  secrets: Record<string, string>;
}): OpenClawConfig["channels"] {
  const slackAccounts: Record<string, SlackAccountConfig> = {};
  const discordAccounts: Record<string, DiscordAccountConfig> = {};
  const feishuAccounts: Record<string, FeishuAccountConfig> = {};
  const socketAppToken = process.env.SLACK_SOCKET_MODE_APP_TOKEN;
  const useSlackSocketMode =
    typeof socketAppToken === "string" && socketAppToken.length > 0;

  for (const channel of params.channels) {
    if (channel.status !== "connected") {
      continue;
    }

    const secret = buildSecretLookup(params.secrets, channel.id);

    if (channel.channelType === "slack") {
      slackAccounts[channel.accountId] = {
        enabled: true,
        botToken: secret("botToken"),
        signingSecret: secret("signingSecret"),
        mode: useSlackSocketMode ? "socket" : "http",
        webhookPath: useSlackSocketMode
          ? undefined
          : `/slack/events/${channel.accountId}`,
        appToken: useSlackSocketMode ? socketAppToken : undefined,
        streaming: "partial",
        replyToMode: "off",
        typingReaction: "hourglass_flowing_sand",
        groupPolicy: "open",
        dmPolicy: "open",
        allowFrom: ["*"],
        requireMention: true,
        ackReaction: "eyes",
      };
      continue;
    }

    if (channel.channelType === "discord") {
      discordAccounts[channel.accountId] = {
        enabled: true,
        token: secret("botToken"),
        groupPolicy: "open",
      };
      continue;
    }

    if (channel.channelType === "feishu") {
      const connectionMode =
        secret("connectionMode") === "webhook" ? "webhook" : "websocket";
      feishuAccounts[channel.accountId] = {
        enabled: true,
        appId: secret("appId") || channel.appId || channel.accountId,
        appSecret: secret("appSecret"),
        connectionMode,
        ...(connectionMode === "webhook"
          ? {
              webhookPath: `/feishu/events/${channel.accountId}`,
              webhookPort: 18790,
              webhookHost: "0.0.0.0",
              ...(secret("verificationToken")
                ? { verificationToken: secret("verificationToken") }
                : {}),
            }
          : {}),
      };
    }
  }

  return {
    ...(Object.keys(slackAccounts).length > 0
      ? {
          slack: {
            mode: useSlackSocketMode ? "socket" : "http",
            signingSecret: Object.values(slackAccounts)[0]?.signingSecret,
            enabled: true,
            groupPolicy: "open",
            requireMention: true,
            dmPolicy: "open",
            allowFrom: ["*"],
            ackReaction: "eyes",
            accounts: slackAccounts,
          },
        }
      : {}),
    ...(Object.keys(discordAccounts).length > 0
      ? {
          discord: {
            enabled: true,
            groupPolicy: "open",
            dmPolicy: "open",
            allowFrom: ["*"],
            accounts: discordAccounts,
          },
        }
      : {}),
    ...(Object.keys(feishuAccounts).length > 0
      ? {
          feishu: {
            enabled: true,
            streaming: false,
            renderMode: "card",
            dmPolicy: "open",
            groupPolicy: "open",
            requireMention: true,
            allowFrom: ["*"],
            tools: {
              doc: true,
              chat: true,
              wiki: true,
              drive: true,
              perm: true,
              scopes: true,
            },
            accounts: feishuAccounts,
          },
        }
      : {}),
  };
}
