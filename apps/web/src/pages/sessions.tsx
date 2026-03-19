import { BrandMark } from "@/components/brand-mark";
import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { Loader2, MessageSquare, WifiOff } from "lucide-react";
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

/** Extract display text from various message content formats. */
function extractText(msg: Record<string, unknown>): string {
  let raw = "";
  // Format 1: msg.text (shorthand)
  if (typeof msg.text === "string") {
    raw = msg.text;
  } else if (typeof msg.content === "string") {
    // Format 2: msg.content (string)
    raw = msg.content;
  } else if (Array.isArray(msg.content)) {
    // Format 3: msg.content (array of blocks)
    raw = (msg.content as Record<string, unknown>[])
      .filter((b) => b?.type === "text")
      .map((b) => String(b?.text ?? ""))
      .join("\n");
  }
  return stripMetadata(raw);
}

/** Millisecond timestamp → HH:mm */
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
  { bg: string; emoji: string; label: string }
> = {
  slack: { bg: "bg-purple-500/15", emoji: "#", label: "Slack" },
  discord: { bg: "bg-indigo-500/15", emoji: "\uD83C\uDFAE", label: "Discord" },
  whatsapp: {
    bg: "bg-emerald-500/15",
    emoji: "\uD83D\uDCAC",
    label: "WhatsApp",
  },
  telegram: { bg: "bg-blue-500/15", emoji: "\u2708\uFE0F", label: "Telegram" },
  feishu: { bg: "bg-blue-500/15", emoji: "\uD83D\uDC26", label: "Feishu" },
  web: { bg: "bg-gray-500/15", emoji: "\uD83C\uDF10", label: "Web" },
};

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
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-surface-3">
          <MessageSquare className="h-8 w-8 text-text-muted" />
        </div>
        <h3 className="mb-2 text-lg font-medium text-text-primary">
          {t("sessions.chat.empty")}
        </h3>
        <p className="max-w-sm text-sm text-text-muted">
          {t("sessions.chat.emptyDesc")}
        </p>
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

function ChatBubble({ msg }: { msg: ChatMessageData }) {
  const text = extractText(msg as unknown as Record<string, unknown>);
  const time = formatTs(msg.timestamp);

  if (msg.role === "user") {
    return (
      <div className="ml-auto max-w-[75%]">
        <div className="bg-gray-800 text-white rounded-2xl rounded-tr-md px-4 py-2.5 text-[13px] whitespace-pre-wrap break-words">
          {text}
        </div>
        {time && (
          <div className="text-right text-[10px] text-text-muted mt-1">
            {time}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mr-auto max-w-[75%] flex gap-2.5">
      <BrandMark className="w-6 h-6 shrink-0 mt-1" />
      <div className="min-w-0">
        <div className="bg-surface-2 text-text-primary rounded-2xl rounded-tl-md px-4 py-2.5 text-[13px] whitespace-pre-wrap break-words">
          {text}
        </div>
        {time && <div className="text-[10px] text-text-muted mt-1">{time}</div>}
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
  };
  const messageCount = session?.messageCount ?? messages.length;
  const lastActive = session?.lastMessageAt ?? session?.updatedAt ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Chat Header */}
      <div className="shrink-0 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex justify-center items-center rounded-lg shrink-0",
              platformCfg.bg,
            )}
            style={{ width: 32, height: 32 }}
          >
            <span className="text-sm">{platformCfg.emoji}</span>
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[15px] font-semibold text-text-primary truncate">
              {session?.title ?? id}
            </h1>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <span>{platformCfg.label}</span>
              <span>·</span>
              <span>
                {t("sessions.chat.messages", { count: messageCount })}
              </span>
              {lastActive && (
                <>
                  <span>·</span>
                  <span>
                    {t("sessions.chat.lastActive", {
                      time: formatRelativeTime(lastActive),
                    })}
                  </span>
                </>
              )}
            </div>
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
          <div className="max-w-3xl mx-auto px-4 py-4 sm:px-6 space-y-3">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} msg={msg} />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  );
}
