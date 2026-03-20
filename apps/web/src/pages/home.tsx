import { ActivityFeed } from "@/components/activity-feed";
import { ChannelConnectModal } from "@/components/channel-connect-modal";
import { InlineModelSelector } from "@/components/inline-model-selector";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import "@/lib/api";
import {
  deleteApiV1ChannelsByChannelId,
  getApiInternalDesktopReady,
  getApiV1Channels,
  getApiV1ChannelsLiveStatus,
  getApiV1Sessions,
} from "../../lib/api/sdk.gen";

type ChannelLiveStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error"
  | "restarting";

type ChannelLiveStatusEntry = {
  channelType: string;
  channelId: string;
  accountId: string;
  status: ChannelLiveStatus;
  ready: boolean;
  connected: boolean;
  running: boolean;
  configured: boolean;
  lastError: string | null;
};

type LiveStatusResponse = {
  gatewayConnected: boolean;
  channels: ChannelLiveStatusEntry[];
  agent: {
    modelId: string | null;
    modelName: string | null;
    alive: boolean;
  };
};

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

const SLACK_SVG = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" role="img">
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
  <svg width="16" height="16" viewBox="0 0 24 24" fill="#5865F2" role="img">
    <title>Discord</title>
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
  </svg>
);

const FEISHU_ICON = (
  <img
    width={16}
    height={16}
    alt="Feishu"
    src="/feishu-logo.png"
    style={{ objectFit: "contain" }}
  />
);

const ONBOARDING_CHANNELS = [
  {
    id: "feishu",
    name: "Feishu",
    icon: FEISHU_ICON,
    recommended: true,
  },
  {
    id: "slack",
    name: "Slack",
    icon: SLACK_SVG,
    recommended: false,
  },
  {
    id: "discord",
    name: "Discord",
    icon: DISCORD_SVG,
    recommended: false,
  },
];

function getChannelOptions(t: (key: string) => string) {
  return [
    {
      id: "feishu",
      name: t("home.channel.feishu"),
      icon: FEISHU_ICON,
      recommended: true,
    },
    {
      id: "slack",
      name: t("home.channel.slack"),
      icon: SLACK_SVG,
      recommended: false,
    },
    {
      id: "discord",
      name: t("home.channel.discord"),
      icon: DISCORD_SVG,
      recommended: false,
    },
  ];
}

function getChannelStatusMeta(
  status: ChannelLiveStatus | undefined,
  t: (key: string) => string,
): { colorClass: string; pulse: boolean; label: string } {
  switch (status) {
    case "connected":
      return {
        colorClass: "bg-[var(--color-success)]",
        pulse: false,
        label: t("home.connected"),
      };
    case "connecting":
      return {
        colorClass: "bg-[var(--color-warning)]",
        pulse: true,
        label: t("home.channelConnecting"),
      };
    case "restarting":
      return {
        colorClass: "bg-[var(--color-warning)]",
        pulse: true,
        label: t("home.channel.restarting"),
      };
    case "error":
      return {
        colorClass: "bg-[var(--color-danger)]",
        pulse: false,
        label: t("home.channel.error"),
      };
    default:
      return {
        colorClass: "bg-text-muted/40",
        pulse: false,
        label: t("home.channel.disconnected"),
      };
  }
}

export function HomePage() {
  const { t } = useTranslation();
  const [modalChannel, setModalChannel] = useState<
    "feishu" | "slack" | "discord" | null
  >(null);
  const queryClient = useQueryClient();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoHover, setVideoHover] = useState(false);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);
  const connectingToastIdRef = useRef<string | number | null>(null);
  const previousLiveStatusesRef = useRef<Record<string, ChannelLiveStatus>>({});
  // Suppress status-change toasts during startup grace period (first config
  // push triggers SIGUSR1 → brief disconnect → reconnect cycle).
  const mountedAtRef = useRef(Date.now());
  const STARTUP_GRACE_MS = 15_000;

  const CHANNEL_OPTIONS = useMemo(() => getChannelOptions(t), [t]);

  // Runtime health status (polls every 5s)
  const { data: runtimeData } = useQuery({
    queryKey: ["runtime-ready"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopReady();
      return data;
    },
    refetchInterval: 5000,
  });

  const runtimeDisplay = useMemo(() => {
    if (!runtimeData) {
      // Still loading — show starting
      return {
        label: t("home.status.starting"),
        color: "var(--color-warning)",
        pulse: true,
      } as const;
    }
    switch (runtimeData.status) {
      case "active":
        return {
          label: t("home.running"),
          color: "var(--color-success)",
          pulse: false,
        } as const;
      case "degraded":
        return {
          label: t("home.status.degraded"),
          color: "var(--color-warning)",
          pulse: true,
        } as const;
      case "unhealthy":
        return {
          label: t("home.status.offline"),
          color: "var(--color-danger)",
          pulse: true,
        } as const;
      default:
        return {
          label: t("home.status.starting"),
          color: "var(--color-warning)",
          pulse: true,
        } as const;
    }
  }, [runtimeData, t]);

  // Idle scene status (no channels)
  const idleDisplay = useMemo(() => {
    if (!runtimeData) {
      return {
        label: t("home.status.starting"),
        subtitle: t("home.status.subtitle.starting"),
        color: "var(--color-warning)",
        pulse: true,
      } as const;
    }
    switch (runtimeData.status) {
      case "active":
        return {
          label: t("home.status.ready"),
          subtitle: t("home.status.subtitle.idle"),
          color: "var(--color-success)",
          pulse: false,
        } as const;
      case "degraded":
        return {
          label: t("home.status.degraded"),
          subtitle: t("home.status.subtitle.degraded"),
          color: "var(--color-warning)",
          pulse: true,
        } as const;
      case "unhealthy":
        return {
          label: t("home.status.offline"),
          subtitle: t("home.status.subtitle.offline"),
          color: "var(--color-danger)",
          pulse: true,
        } as const;
      default:
        return {
          label: t("home.status.starting"),
          subtitle: t("home.status.subtitle.starting"),
          color: "var(--color-warning)",
          pulse: true,
        } as const;
    }
  }, [runtimeData, t]);

  const handleConnected = async () => {
    await queryClient.refetchQueries({ queryKey: ["channels"] });
    await queryClient.refetchQueries({ queryKey: ["channels-live-status"] });
    setModalChannel(null);
  };

  const disconnectChannel = useMutation({
    mutationFn: async (channelId: string) => {
      const toastId = toast.loading(t("home.disconnecting"));
      const { error } = await deleteApiV1ChannelsByChannelId({
        path: { channelId },
      });
      if (error) {
        toast.error(t("home.disconnectFailed"), { id: toastId });
        throw new Error("Failed to disconnect channel");
      }
      toast.success(t("home.disconnected"), { id: toastId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
    },
  });

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
  const hasChannel = connectedCount > 0;
  const connectedTypes = new Set<string>(channels.map((c) => c.channelType));

  const { data: liveStatus } = useQuery({
    queryKey: ["channels-live-status"],
    queryFn: async () => {
      const { data } = await getApiV1ChannelsLiveStatus();
      return data as LiveStatusResponse | undefined;
    },
    refetchInterval: hasChannel ? 3000 : false,
    enabled: hasChannel,
  });

  const liveStatusByChannelType = useMemo(() => {
    const entries = liveStatus?.channels ?? [];
    return new Map(entries.map((entry) => [entry.channelType, entry]));
  }, [liveStatus]);

  const liveStatusByChannelId = useMemo(() => {
    const entries = liveStatus?.channels ?? [];
    return new Map(entries.map((entry) => [entry.channelId, entry]));
  }, [liveStatus]);

  const agentIndicator = useMemo(() => {
    if (!hasChannel || !liveStatus?.agent) {
      return null;
    }
    return liveStatus.agent.alive
      ? {
          colorClass: "bg-[var(--color-success)]",
          pulse: false,
          label: t("home.agent.alive"),
        }
      : {
          colorClass: "bg-[var(--color-warning)]",
          pulse: true,
          label: t("home.agent.starting"),
        };
  }, [hasChannel, liveStatus, t]);

  const handleChannelCreated = useCallback(
    (channelId: string) => {
      setPendingChannelId(channelId);
      connectingToastIdRef.current = toast.loading(
        t("home.channel.phase.connecting"),
      );
      void queryClient.refetchQueries({ queryKey: ["channels-live-status"] });
    },
    [queryClient, t],
  );

  useEffect(() => {
    const toastId = connectingToastIdRef.current;
    if (!toastId || !pendingChannelId) {
      return;
    }
    const pending = liveStatusByChannelId.get(pendingChannelId);
    if (!pending) {
      toast.loading(t("home.channel.phase.configuring"), { id: toastId });
      return;
    }
    if (pending.status === "connected") {
      toast.success(t("home.channel.phase.done"), { id: toastId });
      connectingToastIdRef.current = null;
      setPendingChannelId(null);
      return;
    }
    if (pending.status === "error") {
      toast.error(pending.lastError ?? t("home.channel.error"), {
        id: toastId,
      });
      connectingToastIdRef.current = null;
      setPendingChannelId(null);
      return;
    }
    if (pending.status === "restarting") {
      toast.loading(t("home.channel.phase.configuring"), { id: toastId });
      return;
    }
    toast.loading(t("home.channel.phase.almostReady"), { id: toastId });
  }, [liveStatusByChannelId, pendingChannelId, t]);

  useEffect(() => {
    const previous = previousLiveStatusesRef.current;
    const inGracePeriod = Date.now() - mountedAtRef.current < STARTUP_GRACE_MS;
    for (const entry of liveStatus?.channels ?? []) {
      const last = previous[entry.channelId];
      // Skip channels being tracked by the pending-channel toast above,
      // and suppress during the startup grace period where the initial
      // config push causes a brief disconnect → reconnect cycle.
      if (entry.channelId !== pendingChannelId && !inGracePeriod) {
        if (last && last !== "connected" && entry.status === "connected") {
          toast.success(t("home.channel.phase.done"));
        }
      }
      previous[entry.channelId] = entry.status;
    }
  }, [liveStatus, pendingChannelId, t]);

  // Video playback effects — reset when channel state changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: hasChannel triggers reset intentionally
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
  }, [hasChannel]);

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

  /* ══════════════════════════════════════════════════════════════════════
     Scene A: First-run — No channels connected (Idle state)
     ══════════════════════════════════════════════════════════════════════ */
  if (!hasChannel && !channelsLoading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">
          {/* ═══ TOP: Hero — Bot idle, waiting to be activated ═══ */}
          <div className="flex flex-col items-center text-center">
            <div
              className="relative w-32 h-32 mb-5 cursor-default"
              onMouseEnter={() => setVideoHover(true)}
              onMouseLeave={() => setVideoHover(false)}
            >
              <video
                ref={videoRef}
                src="/nexu-alpha.mp4"
                poster="/nexu-alpha-poster.jpg"
                preload="auto"
                autoPlay
                loop
                muted
                playsInline
                className="w-full h-full object-contain"
              />
            </div>
            <h2
              className="text-[26px] font-normal tracking-tight text-text-primary mb-1.5"
              style={{ fontFamily: "var(--font-script)" }}
            >
              nexu alpha
            </h2>
            <div className="flex items-center gap-3 text-[11px] text-text-muted">
              <span
                className="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: `color-mix(in srgb, ${idleDisplay.color} 10%, transparent)`,
                  color: idleDisplay.color,
                }}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${idleDisplay.pulse ? "animate-pulse" : ""}`}
                  style={{ backgroundColor: idleDisplay.color }}
                />
                {idleDisplay.label}
              </span>
              <span>{idleDisplay.subtitle}</span>
            </div>

            {/* Speech bubble — minimal pill */}
            <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-surface-1 border border-border/60 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-brand-primary)] animate-pulse shrink-0" />
              <span className="text-[12px] text-text-secondary">
                Connect an IM channel to activate me.
              </span>
            </div>
          </div>

          {/* ═══ MIDDLE: Channels — default open, Feishu highlighted ═══ */}
          <div className="card card-static overflow-visible">
            <div className="px-5 pt-4 pb-3">
              <span className="text-[12px] font-medium text-text-primary">
                Choose a channel to get started
              </span>
            </div>
            <div className="px-5 pb-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {ONBOARDING_CHANNELS.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() =>
                      setModalChannel(ch.id as "feishu" | "slack" | "discord")
                    }
                    className={`group relative rounded-xl border px-3 py-3 text-left transition-all cursor-pointer active:scale-[0.98] border-border bg-surface-0 hover:border-border-hover hover:bg-surface-1 ${
                      ch.recommended ? "animate-breathe" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center border border-border bg-white shrink-0">
                        {ch.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-text-primary">
                          {ch.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-text-muted">
                          Add nexu Bot
                        </div>
                      </div>
                      <ArrowRight
                        size={13}
                        className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0 mt-0.5"
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {modalChannel && (
          <ChannelConnectModal
            channelType={modalChannel}
            onClose={() => setModalChannel(null)}
            onConnected={handleConnected}
            onConnectedChannelCreated={handleChannelCreated}
          />
        )}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Scene B: Operational — Channels connected (Running state)
     ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-6">
        {/* ═══ TOP: Hero — Bot running (horizontal layout) ═══ */}
        <div className="flex items-center gap-6">
          <div
            className="relative w-24 h-24 cursor-default shrink-0"
            onMouseEnter={() => setVideoHover(true)}
            onMouseLeave={() => setVideoHover(false)}
          >
            <video
              ref={videoRef}
              src="/nexu-alpha.mp4"
              poster="/nexu-alpha-poster.jpg"
              preload="auto"
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-contain"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <h2
                className="text-[26px] font-normal tracking-tight text-text-primary"
                style={{ fontFamily: "var(--font-script)" }}
              >
                nexu alpha
              </h2>
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                style={{
                  backgroundColor: `color-mix(in srgb, ${runtimeDisplay.color} 10%, transparent)`,
                  color: runtimeDisplay.color,
                }}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${runtimeDisplay.pulse ? "animate-pulse" : ""}`}
                  style={{ backgroundColor: runtimeDisplay.color }}
                />
                {runtimeDisplay.label}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <InlineModelSelector />
              {agentIndicator && (
                <span
                  className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  title={agentIndicator.label}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${agentIndicator.colorClass} ${agentIndicator.pulse ? "animate-pulse" : ""}`}
                  />
                  {agentIndicator.label}
                </span>
              )}
              <div className="flex items-center gap-2 text-[11px] text-text-muted ml-3">
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
            </div>
          </div>
        </div>

        {/* ═══ MIDDLE: Channels panel ═══ */}
        <div className="card card-static">
          <div className="px-5 pt-4 pb-3">
            <h2 className="text-[14px] font-semibold text-text-primary">
              Channels
            </h2>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {/* Connected channels — full width rows with green dot */}
            {CHANNEL_OPTIONS.filter((ch) => connectedTypes.has(ch.id)).length >
              0 && (
              <div className="space-y-1.5">
                {CHANNEL_OPTIONS.filter((ch) => connectedTypes.has(ch.id)).map(
                  (ch) => {
                    const connectedChannel = channels.find(
                      (c) => c.channelType === ch.id,
                    );
                    const statusEntry = connectedChannel
                      ? liveStatusByChannelId.get(connectedChannel.id)
                      : liveStatusByChannelType.get(ch.id);
                    const statusMeta = getChannelStatusMeta(
                      statusEntry?.status,
                      t,
                    );
                    const channelChatUrl = connectedChannel
                      ? getChatUrl(
                          ch.id,
                          connectedChannel.appId,
                          connectedChannel.botUserId,
                          connectedChannel.accountId,
                        )
                      : "";
                    return (
                      <button
                        type="button"
                        key={ch.id}
                        className="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 cursor-pointer transition-all hover:bg-surface-1 text-left"
                        onClick={() =>
                          window.open(
                            channelChatUrl,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        <div className="w-8 h-8 rounded-[10px] flex items-center justify-center border border-border bg-white shrink-0">
                          {ch.icon}
                        </div>
                        <div className="flex-1 min-w-0 flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-text-primary">
                            {ch.name}
                          </span>
                          <span
                            title={statusEntry?.lastError ?? statusMeta.label}
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusMeta.colorClass} ${statusMeta.pulse ? "animate-pulse" : ""}`}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (connectedChannel) {
                              disconnectChannel.mutate(connectedChannel.id);
                            }
                          }}
                          disabled={disconnectChannel.isPending}
                          className="rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium bg-surface-2 text-text-secondary hover:text-[var(--color-danger)] hover:bg-surface-3 transition-colors shrink-0 disabled:opacity-50"
                        >
                          {statusMeta.label}
                        </button>
                        <a
                          href={channelChatUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-[12px] font-medium text-text-secondary hover:text-text-primary transition-colors ml-3 shrink-0 leading-none"
                        >
                          Chat
                          <ArrowUpRight size={12} className="-mt-px" />
                        </a>
                      </button>
                    );
                  },
                )}
              </div>
            )}

            {/* Not-yet-connected channels — dashed border grid */}
            {CHANNEL_OPTIONS.filter((ch) => !connectedTypes.has(ch.id)).length >
              0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CHANNEL_OPTIONS.filter((ch) => !connectedTypes.has(ch.id)).map(
                  (ch) => (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() =>
                        setModalChannel(ch.id as "feishu" | "slack" | "discord")
                      }
                      className="group flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-surface-0 px-3 py-2 text-left hover:border-solid hover:border-border-hover hover:bg-surface-1 transition-all"
                    >
                      <div className="w-6 h-6 rounded-md flex items-center justify-center bg-surface-1 shrink-0">
                        {ch.icon}
                      </div>
                      <span className="text-[12px] font-medium text-text-muted group-hover:text-text-secondary flex-1 truncate">
                        {ch.name}
                      </span>
                      <ArrowRight
                        size={12}
                        className="text-text-muted group-hover:text-text-primary transition-colors shrink-0"
                      />
                    </button>
                  ),
                )}
              </div>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <ActivityFeed />
      </div>

      {modalChannel && (
        <ChannelConnectModal
          channelType={modalChannel}
          onClose={() => setModalChannel(null)}
          onConnected={handleConnected}
          onConnectedChannelCreated={handleChannelCreated}
        />
      )}
    </div>
  );
}
