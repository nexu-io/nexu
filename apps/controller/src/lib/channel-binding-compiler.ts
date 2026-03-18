import type { BindingConfig, OpenClawConfig } from "@nexu/shared";
import type { BotResponse, ChannelResponse } from "@nexu/shared";

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
  const slackAccounts: NonNullable<
    OpenClawConfig["channels"]["slack"]
  >["accounts"] = {};
  const discordAccounts: NonNullable<
    OpenClawConfig["channels"]["discord"]
  >["accounts"] = {};
  const feishuAccounts: NonNullable<
    OpenClawConfig["channels"]["feishu"]
  >["accounts"] = {};

  for (const channel of params.channels) {
    if (channel.status !== "connected") {
      continue;
    }

    const secret = (suffix: string) =>
      params.secrets[`channel:${channel.id}:${suffix}`] ?? "";

    if (channel.channelType === "slack") {
      slackAccounts[channel.accountId] = {
        mode: "http",
        botToken: secret("botToken"),
        signingSecret: secret("signingSecret") || undefined,
        enabled: true,
      };
      continue;
    }

    if (channel.channelType === "discord") {
      discordAccounts[channel.accountId] = {
        token: secret("botToken"),
        enabled: true,
        groupPolicy: "open",
      };
      continue;
    }

    if (channel.channelType === "feishu") {
      feishuAccounts[channel.accountId] = {
        appId: channel.appId ?? channel.accountId,
        appSecret: secret("appSecret"),
        verificationToken: secret("verificationToken") || undefined,
        enabled: true,
      };
    }
  }

  return {
    ...(Object.keys(slackAccounts).length > 0
      ? { slack: { enabled: true, accounts: slackAccounts } }
      : {}),
    ...(Object.keys(discordAccounts).length > 0
      ? { discord: { enabled: true, accounts: discordAccounts } }
      : {}),
    ...(Object.keys(feishuAccounts).length > 0
      ? { feishu: { enabled: true, accounts: feishuAccounts } }
      : {}),
  };
}
