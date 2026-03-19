import { ActivityFeed } from "@/components/activity-feed";
import { ChannelConnectModal } from "@/components/channel-connect-modal";
import { InlineModelSelector } from "@/components/inline-model-selector";
import { useActiveChannel } from "@/hooks/use-active-channel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronDown,
  MessageSquare,
  Settings,
  Sparkles,
  Unlink,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import {
  deleteApiV1ChannelsByChannelId,
  getApiV1ChannelsByChannelIdReadiness,
  getApiV1Channels,
  getApiV1Sessions,
} from "../../lib/api/sdk.gen";

function formatRelativeTime(
  date: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!date) return t("home.noActivity");
  const diff = Date.now() - new Date(date).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t("home.justActive");
  if (minutes < 60) return t("home.minutesAgo", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("home.hoursAgo", { count: hours });
  const days = Math.floor(hours / 24);
  return t("home.daysAgo", { count: days });
}

const GITHUB_URL = "https://github.com/nexu-io/nexu";

function getChatUrl(
  channelType: string,
  appId?: string | null,
  botUserId?: string | null,
  accountId?: string,
): string {
  switch (channelType) {
    case "feishu":
      return appId
        ? `https://applink.feishu.cn/client/bot/open?appId=${appId}`
        : "https://www.feishu.cn/";
    case "slack": {
      // accountId format: "slack-{appId}-{teamId}"
      const teamId = accountId?.replace(/^slack-[^-]+-/, "");
      if (teamId && botUserId) {
        return `https://app.slack.com/client/${teamId}/${botUserId}`;
      }
      return "https://slack.com/";
    }
    case "discord":
      return "https://discord.com/channels/@me";
    default:
      return "https://www.feishu.cn/";
  }
}

function getChannelShortNames(
  t: (key: string) => string,
): Record<string, string> {
  return {
    feishu: t("home.feishu"),
    slack: "Slack",
    discord: "Discord",
  };
}

const SLACK_SVG = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" role="img">
    <title>Slack</title>
    <path
      d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
      fill="#E01E5A"
    />
    <path
      d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
      fill="#36C5F0"
    />
    <path
      d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
      fill="#2EB67D"
    />
    <path
      d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z"
      fill="#ECB22E"
    />
  </svg>
);

const DISCORD_SVG = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="#5865F2" role="img">
    <title>Discord</title>
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const GITHUB_SVG = (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="currentColor"
    className="text-text-primary"
    role="img"
  >
    <title>GitHub</title>
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);

function getChannelOptions(t: (key: string) => string) {
  return [
    {
      id: "feishu",
      name: t("home.channel.feishu"),
      icon: (
        <img
          width={22}
          height={22}
          alt="Feishu"
          src="/feishu-logo.png"
          style={{ objectFit: "contain" }}
        />
      ),
      smallIcon: (
        <img
          width={16}
          height={16}
          alt="Feishu"
          src="/feishu-logo.png"
          style={{ objectFit: "contain" }}
        />
      ),
      subtitle: t("home.channel.addBot"),
      recommended: true,
    },
    {
      id: "slack",
      name: t("home.channel.slack"),
      icon: SLACK_SVG,
      smallIcon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <title>Slack</title>
          <path
            d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z"
            fill="#E01E5A"
          />
          <path
            d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.527 2.527 0 0 1 2.521 2.521 2.527 2.527 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z"
            fill="#36C5F0"
          />
          <path
            d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.163 0a2.528 2.528 0 0 1 2.523 2.522v6.312z"
            fill="#2EB67D"
          />
          <path
            d="M15.163 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.163 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.315A2.528 2.528 0 0 1 24 15.163a2.528 2.528 0 0 1-2.522 2.523h-6.315z"
            fill="#ECB22E"
          />
        </svg>
      ),
      subtitle: t("home.channel.addBot"),
    },
    {
      id: "discord",
      name: t("home.channel.discord"),
      icon: DISCORD_SVG,
      smallIcon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#5865F2">
          <title>Discord</title>
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
        </svg>
      ),
      subtitle: t("home.channel.addBot"),
    },
  ];
}

function TypingText({ message }: { message: string }) {
  const [displayed, setDisplayed] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset typing when message changes
  useEffect(() => {
    setDisplayed("");
  }, [message]);

  useEffect(() => {
    if (displayed.length >= message.length) return;
    const timer = setTimeout(() => {
      setDisplayed(message.slice(0, displayed.length + 1));
    }, 25);
    return () => clearTimeout(timer);
  }, [displayed, message]);

  const done = displayed.length >= message.length;

  return (
    <p className="text-[12px] text-text-muted leading-relaxed max-w-lg">
      {displayed}
      {!done && (
        <span className="inline-block w-0.5 h-3.5 ml-0.5 bg-accent animate-pulse align-middle" />
      )}
    </p>
  );
}

function FeishuIconChat({ size = 14 }: { size?: number }) {
  return (
    <img
      src="/feishu-logo.png"
      width={size}
      height={size}
      alt="Feishu"
      style={{ objectFit: "contain", filter: "brightness(0) invert(1)" }}
    />
  );
}

const actionCardBaseClass =
  "block group rounded-[18px] border border-border/70 bg-surface-1/95 px-3.5 py-2.5 text-left transition-all duration-200 hover:border-border-hover hover:bg-surface-1 hover:shadow-[0_4px_12px_rgba(0,0,0,0.035)]";

export function HomePage() {
  const { t } = useTranslation();
  const [modalChannel, setModalChannel] = useState<
    "feishu" | "slack" | "discord" | null
  >(null);
  const [showChannelManager, setShowChannelManager] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoHover, setVideoHover] = useState(false);

  const CHANNEL_OPTIONS = useMemo(() => getChannelOptions(t), [t]);
  const CHANNEL_SHORT_NAMES = useMemo(() => getChannelShortNames(t), [t]);

  const handleConnected = async () => {
    await queryClient.refetchQueries({ queryKey: ["channels"] });
  };

  const handleDisconnect = async (channelId: string) => {
    try {
      await deleteApiV1ChannelsByChannelId({ path: { channelId } });
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      toast.success(t("home.disconnected"));
    } catch {
      toast.error(t("home.disconnectFailed"));
    }
  };

  // -- Channel readiness polling --
  const readinessPollingRef = useRef<{
    channelId: string;
    timer: ReturnType<typeof setInterval>;
  } | null>(null);

  const startReadinessPolling = useCallback(
    (channelId: string) => {
      if (readinessPollingRef.current) {
        clearInterval(readinessPollingRef.current.timer);
      }

      const toastId = toast.loading(t("home.channel.syncing"));
      let attempts = 0;

      const timer = setInterval(async () => {
        attempts++;
        try {
          const { data } = await getApiV1ChannelsByChannelIdReadiness({
            path: { channelId },
          });

          if (!data?.gatewayConnected) {
            toast.loading(t("home.channel.gatewayStarting"), { id: toastId });
          } else if (data?.ready) {
            clearInterval(timer);
            readinessPollingRef.current = null;
            toast.success(t("home.channel.ready"), { id: toastId });
            return;
          } else if (data?.configured) {
            toast.loading(t("home.channel.connecting"), { id: toastId });
          }

          if (attempts >= 15) {
            clearInterval(timer);
            readinessPollingRef.current = null;
            if (!data?.ready) {
              toast.warning(t("home.channel.readinessTimeout"), {
                id: toastId,
              });
            }
          }
        } catch {
          // Ignore single poll failures, keep trying
        }
      }, 2000);

      readinessPollingRef.current = { channelId, timer };
    },
    [t],
  );

  useEffect(() => {
    return () => {
      if (readinessPollingRef.current) {
        clearInterval(readinessPollingRef.current.timer);
      }
    };
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    v.loop = false;
    v.play().catch(() => {});
    const onEnded = () => {
      v.pause();
    };
    v.addEventListener("ended", onEnded);
    return () => v.removeEventListener("ended", onEnded);
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (videoHover) {
      v.currentTime = 0;
      v.loop = true;
      v.play().catch(() => {});
    } else {
      v.loop = false;
    }
  }, [videoHover]);

  const { data: channelsData, isLoading: channelsLoading } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await getApiV1Channels();
      return data;
    },
  });

  const { data: sessionsData } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data } = await getApiV1Sessions();
      return data;
    },
  });

  const sessions = sessionsData?.sessions ?? [];
  const { messagesToday, lastActiveAt } = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const msgCount = sessions.reduce((sum, s) => {
      const active = s.lastMessageAt && new Date(s.lastMessageAt) >= start;
      return sum + (active ? s.messageCount : 0);
    }, 0);
    const lastActive = sessions.reduce<string | null>((latest, s) => {
      if (!s.lastMessageAt) return latest;
      if (!latest) return s.lastMessageAt;
      return s.lastMessageAt > latest ? s.lastMessageAt : latest;
    }, null);
    return { messagesToday: msgCount, lastActiveAt: lastActive };
  }, [sessions]);

  const channels = channelsData?.channels ?? [];
  const connectedCount = channels.length;
  const connectedTypes = new Set<string>(channels.map((c) => c.channelType));
  const connectedChannelIds = useMemo(
    () => channels.map((c) => c.id),
    [channels],
  );

  // Active channel state (persisted in localStorage)
  const [activeChannelId, setActiveChannelId] =
    useActiveChannel(connectedChannelIds);

  // Derive active channel info for CTA
  const activeChannel = channels.find((c) => c.id === activeChannelId);
  const activeChannelType = activeChannel?.channelType ?? "feishu";
  const chatShortName =
    CHANNEL_SHORT_NAMES[activeChannelType] ?? activeChannelType;
  const chatUrl = getChatUrl(
    activeChannelType,
    activeChannel?.appId,
    activeChannel?.botUserId,
    activeChannel?.accountId,
  );

  /* ── Always show full dashboard ── */
  const welcomeMessage = channelsLoading
    ? "Welcome! 🎉 We're so glad you're here. Loading your setup..."
    : connectedCount > 0
      ? `Welcome! 🎉 We're so glad you're here. Your setup is complete — click "Chat in ${chatShortName}" on the right to start chatting with nexu. We're here whenever you need us.`
      : "Welcome! 🎉 nexu is ready and running. Connect a channel to start chatting, or configure your AI models in Settings.";

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Hero card */}
        <div className="mb-8 rounded-2xl bg-surface-1 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="px-6 pt-6 pb-5">
            {/* Top: Avatar + Identity */}
            <div className="flex items-start gap-6">
              {/* Avatar */}
              <div
                className="relative w-28 h-28 sm:w-36 sm:h-36 rounded-2xl overflow-hidden bg-surface-2 shrink-0 cursor-default"
                onMouseEnter={() => setVideoHover(true)}
                onMouseLeave={() => setVideoHover(false)}
              >
                <video
                  ref={videoRef}
                  src="https://static.refly.ai/video/nexu-alpha.mp4"
                  poster="/nexu-alpha-poster.jpg"
                  preload="auto"
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
              </div>

              {/* Identity + Status + Actions */}
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center gap-3 mb-1">
                  <h2
                    className="text-[22px] sm:text-[26px] font-normal tracking-tight text-text-primary"
                    style={{ fontFamily: "var(--font-script)" }}
                  >
                    nexu Alpha
                  </h2>
                  <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 text-[10px] font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {t("home.running")}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-text-muted mb-3">
                  <InlineModelSelector />
                  <span className="text-border">&middot;</span>
                  <span>
                    {sessionsData
                      ? t("home.todayMessages", { count: messagesToday })
                      : "..."}
                  </span>
                  <span className="text-border">&middot;</span>
                  <span>
                    {sessionsData ? formatRelativeTime(lastActiveAt, t) : "..."}
                  </span>
                </div>
                <TypingText message={welcomeMessage} />
                {/* Actions */}
                <div className="flex items-center gap-2 mt-4">
                  {connectedCount > 0 && (
                    <a
                      href={chatUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-colors"
                    >
                      {activeChannelType === "feishu" ? (
                        <FeishuIconChat size={14} />
                      ) : (
                        CHANNEL_OPTIONS.find((c) => c.id === activeChannelType)
                          ?.smallIcon
                      )}
                      Chat in {chatShortName}
                      <ArrowUpRight size={12} className="opacity-70" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => setShowChannelManager(!showChannelManager)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border border-border text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
                  >
                    <Settings size={13} />
                    {t("home.changeConfig")}
                    <ChevronDown
                      size={12}
                      className={`transition-transform ${showChannelManager ? "rotate-180" : ""}`}
                    />
                  </button>
                </div>
              </div>
            </div>

            {/* Channel manager panel */}
            {showChannelManager && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {CHANNEL_OPTIONS.map((ch) => {
                    const isConnected = connectedTypes.has(ch.id);
                    const connectedChannel = channels.find(
                      (c) => c.channelType === ch.id,
                    );
                    const isActive =
                      isConnected && connectedChannel?.id === activeChannelId;
                    const showBreathe =
                      !isConnected && connectedCount === 0 && ch.recommended;
                    return (
                      <div
                        key={ch.id}
                        className={`rounded-xl border px-3 py-3 transition-all ${
                          isActive
                            ? "border-accent bg-accent/8 ring-1 ring-accent/20"
                            : isConnected
                              ? "border-accent/20 bg-accent/5"
                              : showBreathe
                                ? "border-border bg-surface-0 animate-breathe"
                                : "border-border bg-surface-0"
                        }`}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center border border-border bg-white shrink-0">
                            {ch.smallIcon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[13px] font-medium text-text-primary">
                                {ch.name}
                              </span>
                              {isActive && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
                                  {t("home.active")}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[11px] text-text-muted">
                              {channelsLoading
                                ? t("home.loading")
                                : isConnected
                                  ? t("home.connected")
                                  : t("home.notConnected")}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                          {isConnected && connectedChannel ? (
                            <>
                              {!isActive && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveChannelId(connectedChannel.id)
                                  }
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-accent/30 text-accent hover:bg-accent/5 transition-colors"
                                >
                                  {t("home.setActive")}
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  handleDisconnect(connectedChannel.id)
                                }
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-red-500 hover:bg-red-500/5 border border-red-500/20 hover:border-red-500/30 transition-colors"
                              >
                                <Unlink size={12} />
                                {t("home.disconnect")}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setShowChannelManager(false);
                                setModalChannel(
                                  ch.id as "feishu" | "slack" | "discord",
                                );
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium border border-border text-text-secondary hover:bg-surface-2 hover:border-border-hover transition-colors"
                            >
                              {t("home.connect")}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-7">
          <button
            type="button"
            onClick={() => navigate("/workspace/sessions")}
            className={actionCardBaseClass}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-accent/8 flex items-center justify-center shrink-0">
                  <MessageSquare size={13} className="text-accent" />
                </div>
                <div className="text-[14px] font-semibold text-text-primary truncate">
                  {t("home.viewConversations")}
                </div>
              </div>
              <ArrowUpRight
                size={10}
                className="text-text-muted/45 group-hover:text-accent transition-colors shrink-0"
              />
            </div>
            <div className="mt-1.5 text-[9px] leading-[1.4] text-text-muted/85">
              {t("home.viewConversationsDesc")}
            </div>
          </button>

          <button
            type="button"
            onClick={() => navigate("/workspace/skills")}
            className={actionCardBaseClass}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-accent/8 flex items-center justify-center shrink-0">
                  <Sparkles size={13} className="text-accent" />
                </div>
                <div className="text-[14px] font-semibold text-text-primary truncate">
                  {t("home.manageSkills")}
                </div>
              </div>
              <ArrowUpRight
                size={10}
                className="text-text-muted/45 group-hover:text-accent transition-colors shrink-0"
              />
            </div>
            <div className="mt-1.5 text-[9px] leading-[1.4] text-text-muted/85">
              {t("home.manageSkillsDesc")}
            </div>
          </button>

          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={actionCardBaseClass}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-[#111]/8 dark:bg-white/8 flex items-center justify-center shrink-0">
                  {GITHUB_SVG}
                </div>
                <div className="text-[14px] font-semibold text-text-primary truncate">
                  {t("home.starGithub")}
                </div>
              </div>
              <ArrowUpRight
                size={10}
                className="text-text-muted/45 group-hover:text-accent transition-colors shrink-0"
              />
            </div>
            <div className="mt-1.5 text-[9px] text-text-muted/85">
              {t("home.starGithubDesc")}
            </div>
          </a>
        </div>

        {/* Activity Feed */}
        <ActivityFeed />
      </div>

      {modalChannel && (
        <ChannelConnectModal
          channelType={modalChannel}
          onClose={() => setModalChannel(null)}
          onConnected={handleConnected}
          onStartReadinessPolling={startReadinessPolling}
        />
      )}
    </div>
  );
}
