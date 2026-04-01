import type {
  BindingConfig,
  DiscordAccountConfig,
  FeishuAccountConfig,
  OpenClawConfig,
  SlackAccountConfig,
  TelegramAccountConfig,
  WhatsappAccountConfig,
} from "@nexu/shared";
import type { BotResponse, ChannelResponse } from "@nexu/shared";

/** Prefix for all internal placeholder account IDs that must never be persisted to runtime state. */
export const NEXU_INTERNAL_ACCOUNT_PREFIX = "__nexu_internal_";

const INTERNAL_FEISHU_PREWARM_ACCOUNT_ID = `${NEXU_INTERNAL_ACCOUNT_PREFIX}feishu_prewarm__`;
const INTERNAL_WECHAT_PREWARM_ACCOUNT_ID = `${NEXU_INTERNAL_ACCOUNT_PREFIX}wechat_prewarm__`;

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
        channel:
          channel.channelType === "wechat"
            ? "openclaw-weixin"
            : channel.channelType,
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
  const telegramAccounts: Record<string, TelegramAccountConfig> = {};
  const whatsappAccounts: Record<string, WhatsappAccountConfig> = {};
  const wechatAccounts: Record<string, { enabled: boolean }> = {};
  const socketAppToken = process.env.SLACK_SOCKET_MODE_APP_TOKEN;
  const useSlackSocketMode =
    typeof socketAppToken === "string" && socketAppToken.length > 0;

  for (const channel of params.channels) {
    if (channel.status !== "connected" && channel.channelType !== "feishu") {
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
        dmPolicy: "open",
        allowFrom: ["*"],
      };
      continue;
    }

    if (channel.channelType === "wechat") {
      wechatAccounts[channel.accountId] = { enabled: true };
      continue;
    }

    if (channel.channelType === "telegram") {
      telegramAccounts[channel.accountId] = {
        enabled: true,
        botToken: secret("botToken"),
      };
      continue;
    }

    if (channel.channelType === "whatsapp") {
      whatsappAccounts[channel.accountId] = {
        enabled: true,
        authDir: secret("authDir") || undefined,
      };
      continue;
    }

    if (channel.channelType === "feishu") {
      const connectionMode =
        secret("connectionMode") === "webhook" ? "webhook" : "websocket";
      feishuAccounts[channel.accountId] = {
        enabled: channel.status === "connected",
        appId: secret("appId") || channel.appId || channel.accountId,
        appSecret: secret("appSecret"),
        connectionMode,
        dmPolicy: "open",
        groupPolicy: "open",
        allowFrom: ["*"],
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

  if (Object.keys(feishuAccounts).length === 0) {
    // Keep the Feishu channel subtree stable from the first cold start so the
    // first real Feishu connect only updates account-level config and can
    // restart the Feishu channel instead of forcing a full gateway restart.
    feishuAccounts[INTERNAL_FEISHU_PREWARM_ACCOUNT_ID] = {
      enabled: false,
      appId: "nexu-feishu-prewarm",
      appSecret: "nexu-feishu-prewarm",
      connectionMode: "websocket",
    };
  }

  if (Object.keys(wechatAccounts).length === 0) {
    // Keep the openclaw-weixin channel subtree stable from the first cold
    // start so the first real WeChat connect only updates account-level
    // config and can hot-reload the channel instead of forcing a full
    // gateway restart (~20-45s → ~500ms).
    wechatAccounts[INTERNAL_WECHAT_PREWARM_ACCOUNT_ID] = { enabled: false };
  }

  return {
    ...(Object.keys(slackAccounts).length > 0
      ? {
          slack: {
            mode: useSlackSocketMode ? "socket" : "http",
            signingSecret: Object.values(slackAccounts)[0]?.signingSecret,
            enabled: true,
            requireMention: true,
            accounts: slackAccounts,
          },
        }
      : {}),
    ...(Object.keys(discordAccounts).length > 0
      ? {
          discord: {
            enabled: true,
            accounts: discordAccounts,
          },
        }
      : {}),
    ...(Object.keys(feishuAccounts).length > 0
      ? {
          feishu: {
            enabled: true,
            streaming: true,
            renderMode: "card",
            requireMention: true,
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
    ...(Object.keys(telegramAccounts).length > 0
      ? {
          telegram: {
            enabled: true,
            dmPolicy: "open",
            allowFrom: ["*"],
            groupPolicy: "open",
            groups: {
              "*": {
                requireMention: true,
              },
            },
            accounts: telegramAccounts,
          },
        }
      : {}),
    ...(Object.keys(whatsappAccounts).length > 0
      ? {
          whatsapp: {
            enabled: true,
            dmPolicy: "open",
            allowFrom: ["*"],
            groupPolicy: "open",
            groupAllowFrom: ["*"],
            groups: {
              "*": {
                requireMention: true,
              },
            },
            accounts: whatsappAccounts,
          },
        }
      : {}),
    "openclaw-weixin": {
      enabled: true,
      accounts: wechatAccounts,
    },
  };
}
