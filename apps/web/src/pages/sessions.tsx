import { PlatformIcon } from "@/components/platform-icons";
import { getChannelChatUrl } from "@/lib/channel-links";
import { getSessionFolderUrl, openLocalFolderUrl } from "@/lib/desktop-links";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  FolderOpen,
  Loader2,
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
  // Fallback: if there's a Sender metadata block, take everything after it
  const senderBlockEnd = raw.lastIndexOf("```\n\n");
  if (senderBlockEnd !== -1 && raw.includes("Sender (untrusted metadata)")) {
    return raw.slice(senderBlockEnd + 5).trim();
  }
  return raw;
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
  senderName: string | null;
  hasToolCall: boolean;
  toolCallSummary: string | null;
}

/** Extract display text, sender name, and tool call info from various message content formats. */
function extractMessage(msg: Record<string, unknown>): ExtractedMessage {
  let raw = "";
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
      } else if (b?.type === "toolCall" || b?.type === "tool_use") {
        hasToolCall = true;
        const name = String(b?.name ?? b?.toolName ?? "tool");
        toolCallSummary = name;
      }
    }
    raw = textParts.join("\n");
  }

  const senderName = msg.role === "user" ? extractSenderName(raw) : null;

  return {
    text: stripMetadata(raw),
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

type Platform =
  | "slack"
  | "discord"
  | "whatsapp"
  | "telegram"
  | "web"
  | "feishu";

interface PlatformConfig {
  badgeClass: string;
  label: string;
  openLabel: string;
}

const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  badgeClass:
    "border-[rgba(107,114,128,0.14)] bg-[rgba(107,114,128,0.08)] text-[#6B7280]",
  label: "Web",
  openLabel: "Open",
};

const PLATFORM_CONFIG: Record<Platform, PlatformConfig> = {
  slack: {
    badgeClass:
      "border-[rgba(224,30,90,0.12)] bg-[rgba(224,30,90,0.06)] text-[#E01E5A]",
    label: "Slack",
    openLabel: "Open in Slack",
  },
  discord: {
    badgeClass:
      "border-[rgba(88,101,242,0.14)] bg-[rgba(88,101,242,0.08)] text-[#5865F2]",
    label: "Discord",
    openLabel: "Open in Discord",
  },
  whatsapp: {
    badgeClass:
      "border-[rgba(37,211,102,0.14)] bg-[rgba(37,211,102,0.08)] text-[#25D366]",
    label: "WhatsApp",
    openLabel: "Open in WhatsApp",
  },
  telegram: {
    badgeClass:
      "border-[rgba(36,161,222,0.14)] bg-[rgba(36,161,222,0.08)] text-[#24A1DE]",
    label: "Telegram",
    openLabel: "Open in Telegram",
  },
  feishu: {
    badgeClass:
      "border-[rgba(51,112,255,0.14)] bg-[rgba(51,112,255,0.08)] text-[#3370FF]",
    label: "Feishu",
    openLabel: "Open in Feishu",
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
  "from-emerald-500 to-teal-500",
  "from-orange-400 to-rose-500",
  "from-pink-500 to-fuchsia-500",
  "from-amber-400 to-orange-500",
  "from-sky-400 to-indigo-500",
  "from-lime-400 to-green-500",
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
  return (
    <div className="mt-2 inline-block rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-[13px]">
      <div className="flex items-center gap-1.5 text-emerald-500 font-medium">
        <span>Done!</span>
      </div>
      {summary && (
        <div className="flex items-center gap-1.5 mt-1 text-text-secondary">
          <span>{summary}</span>
        </div>
      )}
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

function ChatBubble({ msg }: { msg: ChatMessageData }) {
  const extracted = extractMessage(msg as unknown as Record<string, unknown>);
  const { text, senderName, hasToolCall, toolCallSummary } = extracted;
  const time = formatTs(msg.timestamp);
  const isBot = msg.role === "assistant";

  const displayName = senderName ?? "User";
  const gradient = getAvatarGradient(displayName);
  const initials = getInitials(displayName);

  return (
    <div
      data-chat-message={msg.id}
      data-chat-role={msg.role}
      className={`flex gap-3 ${isBot ? "" : "flex-row-reverse"}`}
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
      <div className={`max-w-[75%] ${isBot ? "" : "text-right"}`}>
        <div
          className={cn(
            "inline-block px-3.5 py-2.5 rounded-xl text-[13px] leading-relaxed whitespace-pre-line break-words",
            isBot
              ? "bg-surface-1 border border-border text-text-primary rounded-tl-sm"
              : "bg-surface-3 text-text-primary rounded-tr-sm",
          )}
        >
          {text}
        </div>
        {isBot && hasToolCall && <ArtifactCard summary={toolCallSummary} />}
        {time && (
          <div
            className={`text-[10px] text-text-muted mt-1 ${isBot ? "" : "text-right"}`}
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

  const messages = ((chatData as Record<string, unknown> | undefined)
    ?.messages ?? []) as ChatMessageData[];

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
  const messageCount = session?.messageCount || messages.length;
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
      <div className="shrink-0 border-b border-border px-6 py-4">
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
              <span>Open Folder</span>
            </button>
            {platform !== "web" &&
              (externalChatUrl ? (
                <a
                  href={externalChatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClassName}
                >
                  <PlatformIcon platform={platform} size={18} />
                  <span>{platformCfg.openLabel}</span>
                  <ArrowUpRight className="size-[16px] text-text-muted" />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={handleUnavailableChatLink}
                  className={buttonClassName}
                >
                  <PlatformIcon platform={platform} size={18} />
                  <span>{platformCfg.openLabel}</span>
                  <ArrowUpRight className="size-[16px] text-text-muted" />
                </button>
              ))}
          </div>
        </div>
      </div>

      {/* Message List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {chatLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-text-muted" />
            <span className="ml-2 text-sm text-text-muted">
              {t("sessions.chat.loading")}
            </span>
          </div>
        ) : chatError ? (
          <ChatUnavailable />
        ) : messages.length === 0 ? (
          <ChatEmpty />
        ) : (
          <div data-chat-thread={id} className="px-6 py-6 space-y-8">
            <div className="space-y-4">
              {messages
                .filter((msg) => {
                  const { text } = extractMessage(
                    msg as unknown as Record<string, unknown>,
                  );
                  return text.trim().length > 0;
                })
                .map((msg) => (
                  <ChatBubble key={msg.id} msg={msg} />
                ))}
              <div ref={endRef} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
