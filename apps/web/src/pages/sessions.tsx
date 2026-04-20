import { PlatformIcon } from "@/components/platform-icons";
import { ChatMarkdown } from "@/components/ui/chat-markdown";
import { getChannelChatUrl } from "@/lib/channel-links";
import { getSessionFolderUrl, openLocalFolderUrl } from "@/lib/desktop-links";
import { normalizeChannel, track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  CheckCircle2,
  FolderOpen,
  MessageSquare,
  WifiOff,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  getApiV1Channels,
  getApiV1SessionsById,
  getApiV1SessionsByIdMessages,
} from "../../lib/api/sdk.gen";

const BOT_AVATAR = "/brand/ip-nexu.svg";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip OpenClaw-injected metadata blocks from user message text.
 *
 * OpenClaw prepends each user message with "Conversation info (untrusted
 * metadata)" and "Sender (untrusted metadata)" JSON blocks followed by a
 * `[message_id: ...]` line and `senderName: actualMessage`. We extract
 * only the real user text after the last metadata marker.
 */
function stripMetadata(raw: string): string {
  const withoutConversationMeta = raw.replace(
    /Conversation info \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/g,
    "",
  );
  const withoutSenderMeta = withoutConversationMeta.replace(
    /Sender \(untrusted metadata\):\s*```json\s*[\s\S]*?```\s*/g,
    "",
  );
  const withoutReplyMeta = withoutSenderMeta.replace(
    /Replied message \(untrusted, for context\):\s*```json\s*[\s\S]*?```\s*/g,
    "",
  );

  // Pattern 1 (Feishu/Slack): [message_id: ...]\nsenderName: actualMessage
  const markerMatch = raw.match(
    /\[message_id:\s*[^\]]+\](?:\n|\\n)(.+?):\s*([\s\S]*)$/,
  );
  if (markerMatch?.[2] != null) {
    return markerMatch[2].trim();
  }
  // Pattern 2 (webchat): [Thu 2026-03-19 21:05 GMT+8] actualMessage
  const tsMatch = raw.match(
    /^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+GMT[+-]\d+\]\s*([\s\S]*)$/,
  );
  if (tsMatch?.[1] != null) {
    return tsMatch[1].trim();
  }
  if (withoutReplyMeta !== raw) {
    return withoutReplyMeta.trim();
  }
  return raw;
}

function stripAssistantReplyPrefix(raw: string): string {
  return raw.replace(/^\s*\[\[reply_to_current\]\]\s*/u, "");
}

/**
 * Extract sender name from raw message text metadata.
 *
 * Looks for the `[message_id: ...]\nsenderName: actualMessage` pattern
 * and returns the sender name portion.
 */
function extractSenderName(raw: string): string | null {
  const markerMatch = raw.match(
    /\[message_id:\s*[^\]]+\](?:\n|\\n)(.+?):\s*[\s\S]*$/,
  );
  if (markerMatch?.[1] != null) {
    return markerMatch[1].trim();
  }
  return null;
}

interface ExtractedMessage {
  text: string;
  replyContextText: string | null;
  senderName: string | null;
  hasToolCall: boolean;
  toolCallSummary: string | null;
}

function extractReplyContextPrefix(raw: string): {
  text: string;
  replyContextText: string | null;
} {
  const englishMatch = raw.match(
    /^\[Replying to:\s*(?:"([\s\S]*?)"|([^\]]+))\]\s*(?:(?:\r?\n)|\\n)+([\s\S]*)$/u,
  );
  if (englishMatch) {
    return {
      replyContextText: (englishMatch[1] ?? englishMatch[2] ?? "").trim(),
      text: (englishMatch[3] ?? "").trim(),
    };
  }

  const chineseMatch = raw.match(
    /^\[引用:\s*([\s\S]*?)\]\s*(?:(?:\r?\n)|\\n)+([\s\S]*)$/u,
  );
  if (chineseMatch) {
    return {
      replyContextText: (chineseMatch[1] ?? "").trim(),
      text: (chineseMatch[2] ?? "").trim(),
    };
  }

  return {
    text: raw,
    replyContextText: null,
  };
}

/** Extract display text, sender name, and tool call info from various message content formats. */
function extractMessage(msg: Record<string, unknown>): ExtractedMessage {
  let raw = "";
  let replyContextText: string | null = null;
  let hasToolCall = false;
  let toolCallSummary: string | null = null;

  // Format 1: msg.text (shorthand)
  if (typeof msg.text === "string") {
    raw = msg.text;
  } else if (typeof msg.content === "string") {
    // Format 2: msg.content (string)
    raw = msg.content;
  } else if (Array.isArray(msg.content)) {
    // Format 3: msg.content (array of blocks)
    const blocks = msg.content as Record<string, unknown>[];
    const textParts: string[] = [];
    for (const b of blocks) {
      if (b?.type === "text") {
        textParts.push(String(b?.text ?? ""));
      } else if (b?.type === "replyContext") {
        const candidate = String(b?.text ?? "").trim();
        if (candidate.length > 0) {
          replyContextText = candidate;
        }
      } else if (b?.type === "toolCall" || b?.type === "tool_use") {
        hasToolCall = true;
        const name = String(b?.name ?? b?.toolName ?? "tool");
        toolCallSummary = name;
      }
    }
    raw = textParts.join("\n");
  }

  const senderName = msg.role === "user" ? extractSenderName(raw) : null;
  const sanitizedText =
    msg.role === "assistant"
      ? stripAssistantReplyPrefix(stripMetadata(raw))
      : stripMetadata(raw);
  const extractedReply = extractReplyContextPrefix(sanitizedText);
  const text = extractedReply.text;
  replyContextText ??= extractedReply.replyContextText;

  return {
    text,
    replyContextText,
    senderName,
    hasToolCall,
    toolCallSummary,
  };
}

/** Millisecond timestamp -> HH:mm */
function formatTs(ts?: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Format relative time from ISO string */
function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString();
}

function formatToolCallSummary(summary: string | null): string | null {
  if (!summary) return null;

  const uppercaseTokens = new Set([
    "api",
    "ci",
    "csv",
    "db",
    "gh",
    "pdf",
    "qa",
    "sql",
    "ui",
    "ux",
  ]);

  const formatted = summary
    .split(/[_-\s]+/)
    .filter(Boolean)
    .map((token) => {
      const normalized = token.trim();
      if (normalized.length === 0) return "";
      if (/^[A-Z0-9]+$/.test(normalized)) return normalized;
      if (uppercaseTokens.has(normalized.toLowerCase())) {
        return normalized.toUpperCase();
      }
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ")
    .trim();

  if (formatted.length === 0 || formatted.toLowerCase() === "tool") {
    return null;
  }

  return formatted;
}

type Platform =
  | "slack"
  | "discord"
  | "whatsapp"
  | "telegram"
  | "web"
  | "feishu"
  | "dingtalk"
  | "wechat"
  | "wecom"
  | "qqbot";

interface PlatformConfig {
  badgeClass: string;
  label: string;
  openLabel: string;
}

const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  badgeClass:
    "border-[rgba(107,114,128,0.14)] bg-[rgba(107,114,128,0.08)] text-[#6B7280]",
  label: "Web",
  openLabel: "channels.open",
};

const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  slack: {
    badgeClass:
      "border-[rgba(224,30,90,0.12)] bg-[rgba(224,30,90,0.06)] text-[#E01E5A]",
    label: "Slack",
    openLabel: "channels.openInSlack",
  },
  discord: {
    badgeClass:
      "border-[rgba(88,101,242,0.14)] bg-[rgba(88,101,242,0.08)] text-[#5865F2]",
    label: "Discord",
    openLabel: "channels.openInDiscord",
  },
  whatsapp: {
    badgeClass:
      "border-[rgba(37,211,102,0.14)] bg-[rgba(37,211,102,0.08)] text-[#25D366]",
    label: "WhatsApp",
    openLabel: "channels.openInWhatsApp",
  },
  telegram: {
    badgeClass:
      "border-[rgba(36,161,222,0.14)] bg-[rgba(36,161,222,0.08)] text-[#24A1DE]",
    label: "Telegram",
    openLabel: "channels.openInTelegram",
  },
  feishu: {
    badgeClass:
      "border-[rgba(51,112,255,0.14)] bg-[rgba(51,112,255,0.08)] text-[#3370FF]",
    label: "Feishu",
    openLabel: "channels.openInFeishu",
  },
  dingtalk: {
    badgeClass:
      "border-[rgba(44,44,44,0.14)] bg-[rgba(44,44,44,0.08)] text-[#2C2C2C]",
    label: "DingTalk",
    openLabel: "channels.openInDingTalk",
  },
  wecom: {
    badgeClass:
      "border-[rgba(7,193,96,0.14)] bg-[rgba(7,193,96,0.08)] text-[#07C160]",
    label: "WeCom",
    openLabel: "channels.openInWeCom",
  },
  qqbot: {
    badgeClass:
      "border-[rgba(24,144,255,0.14)] bg-[rgba(24,144,255,0.08)] text-[#1890FF]",
    label: "QQ",
    openLabel: "channels.openInQQ",
  },
  wechat: {
    badgeClass:
      "border-[rgba(141,200,27,0.14)] bg-[rgba(141,200,27,0.08)] text-[#8DC81B]",
    label: "WeChat",
    openLabel: "channels.openInWeChat",
  },
  web: DEFAULT_PLATFORM_CONFIG,
};

function getPlatformConfig(platform: string): PlatformConfig {
  return PLATFORM_CONFIG[platform as Platform] ?? DEFAULT_PLATFORM_CONFIG;
}

/** Deterministic gradient for user avatar based on name string */
const AVATAR_GRADIENTS = [
  "from-violet-500 to-purple-600",
  "from-blue-500 to-cyan-500",
  "from-[var(--color-success)] to-teal-500",
  "from-orange-400 to-rose-500",
  "from-pink-500 to-fuchsia-500",
  "from-amber-400 to-orange-500",
  "from-sky-400 to-indigo-500",
  "from-lime-400 to-[var(--color-success)]",
];

function getAvatarGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx] as string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2 && parts[0] && parts[parts.length - 1]) {
    return (
      (parts[0][0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")
    ).toUpperCase();
  }
  return name.slice(0, 1).toUpperCase();
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
          <MessageSquare className="h-8 w-8 text-text-muted" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-text-primary">
          {t("sessions.selectSession")}
        </h3>
        <p className="max-w-sm text-sm text-text-muted">
          {t("sessions.selectSessionDesc")}
        </p>
      </div>
    </div>
  );
}

function ChatEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center py-16">
        <div className="text-[13px] text-text-muted">
          {t("sessions.chat.empty")}
        </div>
      </div>
    </div>
  );
}

function ChatUnavailable() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
          <WifiOff className="h-8 w-8 text-text-muted" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-text-primary">
          {t("sessions.chat.unavailable")}
        </h3>
        <p className="max-w-sm text-sm text-text-muted">
          {t("sessions.chat.unavailableDesc")}
        </p>
      </div>
    </div>
  );
}

interface ChatMessageData {
  id: string;
  role: "user" | "assistant";
  content: unknown;
  timestamp: number | null;
  createdAt: string | null;
}

function ArtifactCard({ summary }: { summary: string | null }) {
  const { t } = useTranslation();
  const formattedSummary =
    formatToolCallSummary(summary) ?? t("sessions.chat.toolActivity");

  return (
    <div
      data-tool-card={summary ?? undefined}
      data-tool-card-variant="inline-chip"
      className="mt-0.5 inline-flex max-w-full items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--color-success)_12%,transparent)] bg-[rgba(0,163,101,0.06)] px-2.5 py-1.5 text-[12px] shadow-none"
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-success-muted)] text-[var(--color-success)]">
        <CheckCircle2 className="size-[13px]" />
      </span>
      <span className="min-w-0 max-w-[16rem] truncate font-medium text-text-primary">
        {formattedSummary}
      </span>
      <span className="shrink-0 text-text-muted/70">·</span>
      <span className="shrink-0 text-[11px] font-medium text-[var(--color-success)]">
        {t("sessions.chat.toolCompleted")}
      </span>
    </div>
  );
}

function ReplyContextCard({
  text,
  isBot,
}: {
  text: string;
  isBot: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-reply-context={text}
      className={cn(
        "inline-flex max-w-full items-start gap-2 rounded-2xl border px-3 py-2 text-left shadow-[0_6px_18px_rgba(15,23,42,0.04)]",
        isBot
          ? "border-border bg-[rgba(248,250,252,0.95)] text-text-secondary"
          : "border-border/70 bg-white/80 text-text-secondary",
      )}
    >
      <span className="mt-0.5 h-8 w-1 shrink-0 rounded-full bg-[rgba(148,163,184,0.6)]" />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
          {t("sessions.chat.replyLabel")}
        </div>
        <div className="mt-1 max-w-[28rem] truncate text-[12px] leading-5">
          {text}
        </div>
      </div>
    </div>
  );
}

function SessionPlatformBadge({
  platform,
  className,
}: {
  platform: string;
  className?: string;
}) {
  const platformCfg = getPlatformConfig(platform);
  return (
    <span
      data-session-platform={platform}
      className={cn(
        "inline-flex items-center justify-center rounded-xl border shadow-[0_1px_2px_rgba(0,0,0,0.03)]",
        platformCfg.badgeClass,
        className,
      )}
    >
      <PlatformIcon platform={platform} size={16} />
    </span>
  );
}

function ChatBubble({
  msg,
  extracted,
}: {
  msg: ChatMessageData;
  extracted?: ExtractedMessage;
}) {
  const resolvedExtracted =
    extracted ?? extractMessage(msg as unknown as Record<string, unknown>);
  const { text, replyContextText, senderName, hasToolCall, toolCallSummary } =
    resolvedExtracted;
  const time = formatTs(msg.timestamp);
  const isBot = msg.role === "assistant";
  const hasText = text.trim().length > 0;
  const hasReplyContext = (replyContextText?.trim().length ?? 0) > 0;

  const displayName = senderName ?? "User";
  const gradient = getAvatarGradient(displayName);
  const initials = getInitials(displayName);

  return (
    <div
      data-chat-message={msg.id}
      data-chat-role={msg.role}
      className={`flex gap-3 ${isBot ? "items-start" : "flex-row-reverse items-end"}`}
    >
      {isBot ? (
        <img
          src={BOT_AVATAR}
          alt=""
          className="shrink-0 w-9 h-9 -ml-1 mt-0 object-contain"
        />
      ) : (
        <div
          className={cn(
            "w-7 h-7 mt-0.5 rounded-lg bg-gradient-to-br flex items-center justify-center shrink-0 ring-1 ring-border/50",
            gradient,
          )}
        >
          <span className="text-[11px] font-semibold text-white leading-none">
            {initials}
          </span>
        </div>
      )}
      <div
        className={cn(
          "flex max-w-[44rem] flex-col gap-2",
          isBot ? "items-start" : "items-end text-right",
        )}
      >
        {hasReplyContext && replyContextText && (
          <ReplyContextCard text={replyContextText} isBot={isBot} />
        )}
        {hasText && (
          <div
            className={cn(
              "inline-block max-w-full rounded-[20px] px-4 py-3 text-[13px] break-words shadow-[0_10px_24px_rgba(15,23,42,0.04)]",
              isBot
                ? "border border-border bg-surface-1 text-text-primary rounded-tl-sm"
                : "bg-surface-3 text-text-primary rounded-tr-sm",
            )}
          >
            <ChatMarkdown content={text} />
          </div>
        )}
        {isBot && hasToolCall && <ArtifactCard summary={toolCallSummary} />}
        {time && (
          <div
            className={`text-[10px] text-text-muted ${isBot ? "pl-1" : "pr-1 text-right"}`}
          >
            {time}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SessionsPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) track("session_detail_view");
  }, [id]);

  // Session metadata
  const { data: session } = useQuery({
    queryKey: ["session-meta", id],
    queryFn: async () => {
      const { data } = await getApiV1SessionsById({ path: { id: id ?? "" } });
      return data;
    },
    enabled: !!id,
  });

  // Chat history
  const {
    data: chatData,
    isLoading: chatLoading,
    isError: chatError,
  } = useQuery({
    queryKey: ["chat-history", id],
    queryFn: async () => {
      const { data } = await getApiV1SessionsByIdMessages({
        path: { id: id ?? "" },
        query: { limit: 200 },
      });
      return data;
    },
    enabled: !!id,
    refetchInterval: 5000,
  });

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await getApiV1Channels();
      return data;
    },
    enabled: !!id,
  });

  // null = not yet loaded, [] = loaded but empty, [...] = loaded with messages
  const messages = (
    chatData ? ((chatData as Record<string, unknown>)?.messages ?? []) : null
  ) as ChatMessageData[] | null;
  const safeMessages = chatLoading ? [] : (messages ?? []);

  // Auto-scroll on new messages
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when messages change
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatData]);

  if (!id) {
    return <EmptyState />;
  }

  const platform = (session?.channelType ?? "web") as Platform;
  const platformCfg = getPlatformConfig(platform);
  const messageCount = session?.messageCount ?? messages?.length ?? 0;
  const lastActive = session?.lastMessageAt ?? session?.updatedAt ?? null;
  const sessionMetadata =
    (session?.metadata as Record<string, unknown> | null | undefined) ?? null;
  const linkedChannel = channelsData?.channels?.find(
    (channel) => channel.id === session?.channelId,
  );
  const sessionFolderUrl = getSessionFolderUrl(sessionMetadata);
  const externalChatUrl =
    platform === "web"
      ? ""
      : getChannelChatUrl(
          platform,
          linkedChannel?.appId,
          linkedChannel?.botUserId,
          linkedChannel?.accountId,
          {
            preferExactSessionTarget: true,
            sessionMetadata,
          },
        );

  // Detect group session from title or metadata
  const isGroup =
    (session?.metadata as Record<string, unknown> | null)?.isGroup === true ||
    (session?.title ?? "").includes("(group)");

  const buttonClassName = cn(
    "inline-flex h-12 items-center justify-center gap-3 rounded-[18px] border bg-white px-5 text-[13px] font-medium text-text-primary shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition-colors",
    "border-[rgba(15,23,42,0.1)] hover:bg-[rgba(248,250,252,0.9)]",
  );

  const handleOpenFolder = async (): Promise<void> => {
    if (!sessionFolderUrl) {
      toast.error("Session folder is unavailable.");
      return;
    }

    try {
      await openLocalFolderUrl(sessionFolderUrl);
    } catch {
      toast.error("Failed to open session folder.");
    }
  };

  const handleUnavailableChatLink = (): void => {
    if (platform === "feishu") {
      toast.info(
        "This session is missing Feishu openChatId metadata, so the exact bot chat cannot be opened yet.",
      );
      return;
    }

    toast.info("This channel does not expose a direct chat link yet.");
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="shrink-0 border-b border-border px-6 py-4 md:pt-12">
        <div className="flex items-center justify-between">
          <div className="flex gap-3 items-center">
            <SessionPlatformBadge
              platform={platform}
              className="h-[34px] w-[34px] shrink-0"
            />
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-bold text-text-heading truncate">
                  {session?.title ?? id}
                </h1>
                {isGroup && (
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-[var(--color-info-subtle)] text-[var(--color-info)]">
                    Group
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-muted mt-0.5">
                {platformCfg.label} ·{" "}
                {t("sessions.chat.messages", { count: messageCount })}
                {lastActive && (
                  <>
                    {" "}
                    ·{" "}
                    {t("sessions.chat.lastActive", {
                      time: formatRelativeTime(lastActive),
                    })}
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              data-session-folder-url={sessionFolderUrl ?? undefined}
              onClick={() => {
                void handleOpenFolder();
              }}
              disabled={!sessionFolderUrl}
              className={cn(
                buttonClassName,
                !sessionFolderUrl && "cursor-not-allowed opacity-60",
              )}
            >
              <FolderOpen className="size-[18px] text-text-secondary" />
              <span>{t("sessions.openFolder")}</span>
            </button>
            {platform !== "web" &&
              platform !== "wechat" &&
              (externalChatUrl ? (
                <a
                  href={externalChatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    const channel = normalizeChannel(platform);
                    if (!channel) {
                      return;
                    }
                    track("workspace_chat_in_im_click", {
                      channel,
                      where: "conversation",
                    });
                  }}
                  className={buttonClassName}
                >
                  <PlatformIcon platform={platform} size={18} />
                  <span>{t(platformCfg.openLabel)}</span>
                  <ArrowUpRight className="size-[16px] text-text-muted" />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={handleUnavailableChatLink}
                  className={buttonClassName}
                >
                  <PlatformIcon platform={platform} size={18} />
                  <span>{t(platformCfg.openLabel)}</span>
                  <ArrowUpRight className="size-[16px] text-text-muted" />
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {chatError ? (
          <ChatUnavailable />
        ) : chatLoading ? null : safeMessages.length === 0 ? (
          <ChatEmpty />
        ) : (
          <div data-chat-thread={id} className="px-4 py-8 sm:px-6">
            <div
              data-chat-layout="centered"
              className="mx-auto flex w-full max-w-[920px] flex-col gap-5"
            >
              {safeMessages
                .map((msg) => ({
                  msg,
                  extracted: extractMessage(
                    msg as unknown as Record<string, unknown>,
                  ),
                }))
                .filter(({ extracted }) => {
                  const { text, replyContextText, hasToolCall } = extracted;
                  return (
                    text.trim().length > 0 ||
                    (replyContextText?.trim().length ?? 0) > 0 ||
                    hasToolCall
                  );
                })
                .map(({ msg, extracted }) => (
                  <ChatBubble key={msg.id} msg={msg} extracted={extracted} />
                ))}
              <div ref={endRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
