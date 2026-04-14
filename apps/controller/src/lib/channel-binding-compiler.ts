import type {
  BindingConfig,
  ChannelType,
  DiscordAccountConfig,
  FeishuAccountConfig,
  OpenClawConfig,
  SlackAccountConfig,
  TelegramAccountConfig,
  WhatsappAccountConfig,
} from "@nexu/shared";
import type { BotResponse, ChannelResponse } from "@nexu/shared";
import { logger } from "./logger.js";

/** Prefix for all internal placeholder account IDs that must never be persisted to runtime state. */
export const NEXU_INTERNAL_ACCOUNT_PREFIX = "__nexu_internal_";

const INTERNAL_FEISHU_PREWARM_ACCOUNT_ID = `${NEXU_INTERNAL_ACCOUNT_PREFIX}feishu_prewarm__`;
const INTERNAL_WECHAT_PREWARM_ACCOUNT_ID = `${NEXU_INTERNAL_ACCOUNT_PREFIX}wechat_prewarm__`;

export const MANAGED_CHANNEL_PLUGIN_IDS: Partial<Record<ChannelType, string>> =
  {
    dingtalk: "dingtalk-connector",
    wecom: "wecom",
    qqbot: "openclaw-qqbot",
    wechat: "openclaw-weixin",
  };

export const QQBOT_DEFAULT_ACCOUNT_ID = "default";

export function resolveOpenClawChannelKey(channelType: ChannelType): string {
  if (channelType === "wechat") {
    return "openclaw-weixin";
  }
  if (channelType === "dingtalk") {
    return "dingtalk-connector";
  }
  return channelType;
}

export function resolveOpenClawRuntimeAccountId(
  channelType: ChannelType,
  accountId: string,
): string {
  if (channelType === "qqbot") {
    return QQBOT_DEFAULT_ACCOUNT_ID;
  }
  if (channelType === "dingtalk" && accountId === "default") {
    return "__default__";
  }
  return accountId;
}

export function resolveManagedChannelPluginId(
  channelType: ChannelType,
): string | null {
  return MANAGED_CHANNEL_PLUGIN_IDS[channelType] ?? null;
}

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
        channel: resolveOpenClawChannelKey(channel.channelType),
        accountId: resolveOpenClawRuntimeAccountId(
          channel.channelType,
          channel.accountId,
        ),
      },
    }));
}

export function compileChannelsConfig(params: {
  channels: ChannelResponse[];
  secrets: Record<string, string>;
  gatewayBaseUrl: string;
  gatewayToken?: string;
}): OpenClawConfig["channels"] {
  const slackAccounts: Record<string, SlackAccountConfig> = {};
  const discordAccounts: Record<string, DiscordAccountConfig> = {};
  const feishuAccounts: Record<string, FeishuAccountConfig> = {};
  const telegramAccounts: Record<string, TelegramAccountConfig> = {};
  const whatsappAccounts: Record<string, WhatsappAccountConfig> = {};
  const wechatAccounts: Record<string, { enabled: boolean }> = {};
  let dingtalkChannel:
    | OpenClawConfig["channels"]["dingtalk-connector"]
    | undefined;
  let wecomChannel: OpenClawConfig["channels"]["wecom"] | undefined;
  let qqbotChannel: OpenClawConfig["channels"]["qqbot"] | undefined;
  const socketAppToken = process.env.SLACK_SOCKET_MODE_APP_TOKEN;
  const useSlackSocketMode =
    typeof socketAppToken === "string" && socketAppToken.length > 0;

  const skippedChannels: Array<{ id: string; type: string; reason: string }> =
    [];

  for (const channel of params.channels) {
    if (channel.status !== "connected" && channel.channelType !== "feishu") {
      skippedChannels.push({
        id: channel.id,
        type: channel.channelType,
        reason: `status=${channel.status}`,
      });
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

    if (channel.channelType === "dingtalk") {
      dingtalkChannel = {
        enabled: true,
        clientId: secret("clientId") || channel.appId || "",
        clientSecret: secret("clientSecret"),
        gatewayBaseUrl: params.gatewayBaseUrl,
        ...(params.gatewayToken ? { gatewayToken: params.gatewayToken } : {}),
        dmPolicy: "open",
        allowFrom: ["*"],
        groupPolicy: "open",
      };
      continue;
    }

    if (channel.channelType === "wecom") {
      wecomChannel = {
        enabled: true,
        botId: secret("botId") || channel.appId || "",
        secret: secret("secret"),
        dmPolicy: "open",
        allowFrom: ["*"],
        groupPolicy: "open",
        groupAllowFrom: ["*"],
        sendThinkingMessage: true,
      };
      continue;
    }

    if (channel.channelType === "qqbot") {
      qqbotChannel = {
        enabled: true,
        appId: secret("appId") || channel.appId || "",
        clientSecret: secret("clientSecret"),
        dmPolicy: "open",
        allowFrom: ["*"],
        groupPolicy: "open",
        groupAllowFrom: ["*"],
        historyLimit: 50,
        markdownSupport: true,
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

  const compiled: Record<string, number> = {};
  if (Object.keys(slackAccounts).length > 0)
    compiled.slack = Object.keys(slackAccounts).length;
  if (Object.keys(discordAccounts).length > 0)
    compiled.discord = Object.keys(discordAccounts).length;
  if (Object.keys(telegramAccounts).length > 0)
    compiled.telegram = Object.keys(telegramAccounts).length;
  if (Object.keys(feishuAccounts).length > 0)
    compiled.feishu = Object.keys(feishuAccounts).length;
  if (Object.keys(whatsappAccounts).length > 0)
    compiled.whatsapp = Object.keys(whatsappAccounts).length;
  if (Object.keys(wechatAccounts).length > 0)
    compiled.wechat = Object.keys(wechatAccounts).length;
  if (dingtalkChannel) compiled.dingtalk = 1;
  if (wecomChannel) compiled.wecom = 1;
  if (qqbotChannel) compiled.qqbot = 1;

  logger.info(
    {
      inputCount: params.channels.length,
      compiled,
      skipped: skippedChannels.length > 0 ? skippedChannels : undefined,
    },
    "compile_channels_summary",
  );

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
            // Card Kit streaming: replies stream in real-time via feishu
            // interactive cards. Without these, replies arrive as plain text
            // after the full LLM response completes (no streaming UX).
            streaming: true,
            renderMode: "card",
            dmPolicy: "open",
            groupPolicy: "open",
            requireMention: true,
            allowFrom: ["*"],
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
    ...(dingtalkChannel ? { "dingtalk-connector": dingtalkChannel } : {}),
    ...(wecomChannel ? { wecom: wecomChannel } : {}),
    ...(qqbotChannel ? { qqbot: qqbotChannel } : {}),
    "openclaw-weixin": {
      enabled: true,
      accounts: wechatAccounts,
    },
  };
}
