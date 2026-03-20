type ChannelLinkOptions = {
  preferExactSessionTarget?: boolean;
  sessionMetadata?: Record<string, unknown> | null;
};

function readStringValue(
  record: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  if (!record) {
    return null;
  }
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getFeishuOpenChatId(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  const direct =
    readStringValue(metadata, "openChatId") ??
    readStringValue(metadata, "open_chat_id") ??
    readStringValue(metadata, "chatId") ??
    readStringValue(metadata, "chat_id");

  if (direct?.startsWith("oc_")) {
    return direct;
  }

  return null;
}

export function getChannelChatUrl(
  channelType: string,
  appId?: string | null,
  botUserId?: string | null,
  accountId?: string | null,
  options?: ChannelLinkOptions,
): string {
  switch (channelType) {
    case "feishu": {
      const openChatId = getFeishuOpenChatId(options?.sessionMetadata);
      if (openChatId) {
        return `https://applink.feishu.cn/client/chat/open?openChatId=${encodeURIComponent(openChatId)}`;
      }
      if (options?.preferExactSessionTarget) {
        return "";
      }
      const resolvedAppId =
        appId ?? accountId?.replace(/^feishu:/, "") ?? undefined;
      return resolvedAppId
        ? `https://applink.feishu.cn/client/bot/open?appId=${resolvedAppId}`
        : "https://www.feishu.cn/";
    }
    case "slack": {
      const teamId = accountId?.replace(/^slack-[^-]+-/, "");
      if (teamId && botUserId) {
        return `https://app.slack.com/client/${teamId}/${botUserId}`;
      }
      return "https://slack.com/";
    }
    case "discord":
      return "https://discord.com/channels/@me";
    case "web":
      return "";
    default:
      return "";
  }
}
