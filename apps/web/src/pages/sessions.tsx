import { BrandMark } from "@/components/brand-mark";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, MessageSquare, WifiOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import {
  getApiV1SessionsById,
  getApiV1SessionsByIdMessages,
} from "../../lib/api/sdk.gen";

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
    /\[message_id:\s*[^\]]+\]\n(.+?):\s*([\s\S]*)$/,
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
  const markerMatch = raw.match(/\[message_id:\s*[^\]]+\]\n(.+?):\s*[\s\S]*$/);
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

const PLATFORM_CONFIG: Record<
  string,
  { bg: string; emoji: string; label: string; openLabel: string }
> = {
  slack: {
    bg: "bg-[rgba(217,153,247,0.15)]",
    emoji: "#",
    label: "Slack",
    openLabel: "Open in Slack",
  },
  discord: {
    bg: "bg-[var(--color-info-subtle)]",
    emoji: "\uD83C\uDFAE",
    label: "Discord",
    openLabel: "Open in Discord",
  },
  whatsapp: {
    bg: "bg-emerald-500/15",
    emoji: "\uD83D\uDCAC",
    label: "WhatsApp",
    openLabel: "Open in WhatsApp",
  },
  telegram: {
    bg: "bg-[var(--color-info-subtle)]",
    emoji: "\u2708\uFE0F",
    label: "Telegram",
    openLabel: "Open in Telegram",
  },
  feishu: {
    bg: "bg-[var(--color-info-subtle)]",
    emoji: "\uD83D\uDC26",
    label: "Feishu",
    openLabel: "Open in Feishu",
  },
  web: {
    bg: "bg-gray-500/15",
    emoji: "\uD83C\uDF10",
    label: "Web",
    openLabel: "Open",
  },
};

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

function NexuThinking() {
  return (
    <div className="flex items-center gap-3">
      <BrandMark className="w-9 h-9 -ml-1 object-contain shrink-0 animate-nexu-bounce" />
      <div className="flex items-center gap-0.5 text-[13px] text-text-tertiary">
        <span>thinking</span>
        <span className="inline-flex gap-[2px] ml-[1px]">
          <span className="animate-dot-fade" style={{ animationDelay: "0s" }}>
            .
          </span>
          <span className="animate-dot-fade" style={{ animationDelay: "0.3s" }}>
            .
          </span>
          <span className="animate-dot-fade" style={{ animationDelay: "0.6s" }}>
            .
          </span>
        </span>
      </div>
    </div>
  );
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

function ChatBubble({ msg }: { msg: ChatMessageData }) {
  const extracted = extractMessage(msg as unknown as Record<string, unknown>);
  const { text, senderName, hasToolCall, toolCallSummary } = extracted;
  const time = formatTs(msg.timestamp);
  const isBot = msg.role === "assistant";

  const displayName = senderName ?? "User";
  const gradient = getAvatarGradient(displayName);
  const initials = getInitials(displayName);

  return (
    <div className={`flex gap-3 ${isBot ? "" : "flex-row-reverse"}`}>
      {isBot ? (
        <BrandMark className="w-9 h-9 -ml-1 mt-0 object-contain shrink-0" />
      ) : (
        <div
          className={cn(
            "w-8 h-8 mt-0.5 rounded-full bg-gradient-to-br flex items-center justify-center shrink-0",
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
            "inline-block px-4 py-2.5 rounded-2xl text-[13px] leading-relaxed whitespace-pre-line break-words",
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
  const platformCfg = PLATFORM_CONFIG[platform] ?? {
    bg: "bg-gray-500/15",
    emoji: "\uD83C\uDF10",
    label: "Web",
    openLabel: "Open",
  };
  const messageCount = session?.messageCount ?? messages.length;
  const lastActive = session?.lastMessageAt ?? session?.updatedAt ?? null;

  // Detect group session from title or metadata
  const isGroup =
    (session?.metadata as Record<string, unknown> | null)?.isGroup === true ||
    (session?.title ?? "").includes("(group)");

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex gap-3 items-center">
            <div
              className={cn(
                "flex justify-center items-center rounded-lg shrink-0",
                platformCfg.bg,
              )}
              style={{ width: 30, height: 30 }}
            >
              <span style={{ fontSize: 13 }}>{platformCfg.emoji}</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[15px] font-bold text-text-heading truncate">
                  {session?.title ?? id}
                </h1>
                {isGroup && (
                  <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
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
          {platform !== "web" && (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-1 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-surface-2"
            >
              {platformCfg.openLabel}
              <ExternalLink className="h-3 w-3" />
            </button>
          )}
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
          <div className="max-w-3xl mx-auto px-6 py-6">
            <div className="space-y-4">
              {messages.map((msg) => (
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
