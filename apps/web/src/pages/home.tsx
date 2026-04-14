import { ActivityFeed } from "@/components/activity-feed";
import { BudgetWarningBanner } from "@/components/budget-warning-banner";
import { ChannelConnectModal } from "@/components/channel-connect-modal";
import { DingtalkSetupView } from "@/components/channel-setup/dingtalk-setup-view";
import { QqbotSetupView } from "@/components/channel-setup/qqbot-setup-view";
import { TelegramSetupView } from "@/components/channel-setup/telegram-setup-view";
import { WechatSetupView } from "@/components/channel-setup/wechat-setup-view";
import { WecomSetupView } from "@/components/channel-setup/wecom-setup-view";
import { WhatsappSetupView } from "@/components/channel-setup/whatsapp-setup-view";
import { GitHubStarCta } from "@/components/github-star-cta";
import { InlineModelSelector } from "@/components/inline-model-selector";
import {
  DingtalkIcon,
  QqbotIcon,
  TelegramIcon,
  WechatIcon,
  WecomIcon,
  WhatsAppIcon,
} from "@/components/platform-icons";
import {
  SEEDANCE_PROMO_DISMISS_KEY,
  SeedancePromoBanner,
  SeedancePromoModal,
} from "@/components/seedance-promo";
import {
  getBudgetBannerRouteVariant,
  useDesktopBudgetGuard,
} from "@/hooks/use-desktop-budget-guard";
import { useDesktopRewardsStatus } from "@/hooks/use-desktop-rewards";
import { useGitHubStars } from "@/hooks/use-github-stars";
import { getChannelChatUrl } from "@/lib/channel-links";
import {
  type ChannelLiveStatus,
  getChannelStatusLabel,
} from "@/lib/channel-live-status";
import { normalizeChannel, track } from "@/lib/tracking";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Cable, X } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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

type BudgetBannerStatus = "healthy" | "warning" | "depleted";
type BudgetBannerDebugMode = "actual" | Exclude<BudgetBannerStatus, "healthy">;

const budgetBannerDebugStorageKey = "nexu_budget_banner_debug_mode";
const showBudgetBannerDebugPanel = import.meta.env.DEV;

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

const DINGTALK_ICON = <DingtalkIcon size={16} />;
const QQBOT_ICON = <QqbotIcon size={16} />;
const TELEGRAM_ICON = <TelegramIcon size={16} />;
const WECOM_ICON = <WecomIcon size={16} />;
const WHATSAPP_ICON = <WhatsAppIcon size={16} />;
/** WeChat mark uses a wide viewBox; bump px so it matches visual weight of 16px square logos. */
type HomeChannelIconBox = "standard" | "compact";

function homeChannelIcon(
  ch: { id: string; icon?: ReactNode },
  box: HomeChannelIconBox = "standard",
) {
  if (ch.id === "wechat") {
    return <WechatIcon size={box === "compact" ? 18 : 22} />;
  }
  return ch.icon ?? null;
}

const ONBOARDING_CHANNELS = [
  {
    id: "wechat",
    name: "WeChat",
    recommended: true,
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: WHATSAPP_ICON,
    recommended: false,
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: TELEGRAM_ICON,
    recommended: false,
  },
  {
    id: "dingtalk",
    name: "DingTalk",
    icon: DINGTALK_ICON,
    recommended: false,
  },
  {
    id: "qqbot",
    name: "QQ",
    icon: QQBOT_ICON,
    recommended: false,
  },
  {
    id: "wecom",
    name: "WeCom",
    icon: WECOM_ICON,
    recommended: false,
  },
  {
    id: "feishu",
    name: "Feishu",
    icon: FEISHU_ICON,
    recommended: false,
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
      id: "wechat",
      name: t("home.channel.wechat"),
      recommended: true,
    },
    {
      id: "whatsapp",
      name: t("home.channel.whatsapp"),
      icon: WHATSAPP_ICON,
      recommended: false,
    },
    {
      id: "telegram",
      name: t("home.channel.telegram"),
      icon: TELEGRAM_ICON,
      recommended: false,
    },
    {
      id: "dingtalk",
      name: t("home.channel.dingtalk"),
      icon: DINGTALK_ICON,
      recommended: false,
    },
    {
      id: "qqbot",
      name: t("home.channel.qqbot"),
      icon: QQBOT_ICON,
      recommended: false,
    },
    {
      id: "wecom",
      name: t("home.channel.wecom"),
      icon: WECOM_ICON,
      recommended: false,
    },
    {
      id: "feishu",
      name: t("home.channel.feishu"),
      icon: FEISHU_ICON,
      recommended: false,
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
        label: getChannelStatusLabel(status, {
          connected: t("home.connected"),
          connecting: t("home.channelConnecting"),
          disconnected: t("home.channel.disconnected"),
          error: t("home.channel.error"),
          restarting: t("home.channel.restarting"),
        }),
      };
    case "error":
      return {
        colorClass: "bg-[var(--color-danger)]",
        pulse: false,
        label: getChannelStatusLabel(status, {
          connected: t("home.connected"),
          connecting: t("home.channelConnecting"),
          disconnected: t("home.channel.disconnected"),
          error: t("home.channel.error"),
          restarting: t("home.channel.restarting"),
        }),
      };
    default:
      return {
        colorClass: "bg-text-muted/40",
        pulse: false,
        label: getChannelStatusLabel(status, {
          connected: t("home.connected"),
          connecting: t("home.channelConnecting"),
          disconnected: t("home.channel.disconnected"),
          error: t("home.channel.error"),
          restarting: t("home.channel.restarting"),
        }),
      };
  }
}

export function HomePage() {
  const { t } = useTranslation();
  const { stars } = useGitHubStars();
  const isDesktopClient = useMemo(
    () =>
      typeof navigator !== "undefined" &&
      navigator.userAgent.includes("Electron"),
    [],
  );
  const [modalChannel, setModalChannel] = useState<
    "feishu" | "slack" | "discord" | null
  >(null);
  const [budgetBannerDebugMode, setBudgetBannerDebugMode] =
    useState<BudgetBannerDebugMode>(() => {
      if (!showBudgetBannerDebugPanel) return "actual";
      try {
        const stored = localStorage.getItem(budgetBannerDebugStorageKey);
        if (stored === "warning" || stored === "depleted") {
          return stored;
        }
      } catch {
        // ignore storage errors
      }
      return "actual";
    });

  const handleBudgetBannerDebugModeChange = useCallback(
    (mode: BudgetBannerDebugMode) => {
      setBudgetBannerDebugMode(mode);
      try {
        if (mode === "actual") {
          localStorage.removeItem(budgetBannerDebugStorageKey);
          return;
        }
        localStorage.setItem(budgetBannerDebugStorageKey, mode);
      } catch {
        // ignore storage errors
      }
    },
    [],
  );
  const [wechatQrOpen, setWechatQrOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [dingtalkOpen, setDingtalkOpen] = useState(false);
  const [qqbotOpen, setQqbotOpen] = useState(false);
  const [wecomOpen, setWecomOpen] = useState(false);
  const [seedancePromoOpen, setSeedancePromoOpen] = useState(false);
  const [showSeedancePromo, setShowSeedancePromo] = useState(() => {
    try {
      return sessionStorage.getItem(SEEDANCE_PROMO_DISMISS_KEY) !== "1";
    } catch {
      return true;
    }
  });
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

  // Runtime health status (polls every 2s for faster feedback)
  const { data: runtimeData } = useQuery({
    queryKey: ["runtime-ready"],
    queryFn: async () => {
      const { data } = await getApiInternalDesktopReady();
      return data;
    },
    refetchInterval: 2000,
  });

  const runtimeDisplay = useMemo(() => {
    if (!runtimeData) {
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
      case "starting":
        return {
          label: t("home.status.starting"),
          color: "var(--color-warning)",
          pulse: true,
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
      case "starting":
        return {
          label: t("home.status.starting"),
          subtitle: t("home.status.subtitle.starting"),
          color: "var(--color-warning)",
          pulse: true,
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

  const { data: sessionsData, isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data } = await getApiV1Sessions();
      return data;
    },
  });

  const sessions = sessionsData?.sessions ?? [];
  const hasSessionHistory = sessions.length > 0;

  const { data: channelsData, isLoading: channelsLoading } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await getApiV1Channels();
      return data;
    },
    refetchInterval: hasSessionHistory ? 3000 : false,
  });

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
  const activeChannels = channels.filter(
    (channel) => channel.status === "connected",
  );
  const configuredConnectedTypes = useMemo(() => {
    return new Set(activeChannels.map((channel) => channel.channelType));
  }, [activeChannels]);
  const connectedCount = configuredConnectedTypes.size;
  const hasChannel = connectedCount > 0;
  const shouldPollLiveStatus =
    hasChannel || pendingChannelId !== null || hasSessionHistory;

  const { data: liveStatus } = useQuery({
    queryKey: ["channels-live-status"],
    queryFn: async () => {
      const { data } = await getApiV1ChannelsLiveStatus();
      console.log(
        "[home:live-status]",
        data?.gatewayConnected,
        data?.channels?.map(
          (c: { channelType: string; status: string }) =>
            `${c.channelType}=${c.status}`,
        ),
      );
      return data as LiveStatusResponse | undefined;
    },
    refetchInterval: shouldPollLiveStatus ? 3000 : false,
    enabled: shouldPollLiveStatus,
  });

  const liveStatusByChannelType = useMemo(() => {
    const entries = liveStatus?.channels ?? [];
    return new Map(entries.map((entry) => [entry.channelType, entry]));
  }, [liveStatus]);

  const liveConnectedTypes = useMemo(() => {
    return new Set(
      (liveStatus?.channels ?? [])
        .filter((entry) => entry.status === "connected")
        .map((entry) => entry.channelType),
    );
  }, [liveStatus]);

  const effectiveConnectedTypes = useMemo(() => {
    return new Set([...configuredConnectedTypes, ...liveConnectedTypes]);
  }, [configuredConnectedTypes, liveConnectedTypes]);

  const hasOperationalContext =
    effectiveConnectedTypes.size > 0 || hasSessionHistory;

  const liveStatusByChannelId = useMemo(() => {
    const entries = liveStatus?.channels ?? [];
    return new Map(entries.map((entry) => [entry.channelId, entry]));
  }, [liveStatus]);

  const agentIndicator = useMemo(() => {
    if (!hasOperationalContext || !liveStatus?.agent) {
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
  }, [hasOperationalContext, liveStatus, t]);
  const budgetBannerDebugPanel = showBudgetBannerDebugPanel ? (
    <BudgetBannerDebugPanel
      actualStatus="healthy"
      mode={budgetBannerDebugMode}
      onModeChange={handleBudgetBannerDebugModeChange}
    />
  ) : null;
  const { status: rewardsStatus } = useDesktopRewardsStatus();
  const { bannerDismissible, budgetStatus, dismissBanner, shouldShowPrompt } =
    useDesktopBudgetGuard({
      pathname: "/workspace/home",
      cloudConnected: rewardsStatus.viewer.cloudConnected,
    });
  const budgetBannerRouteVariant =
    getBudgetBannerRouteVariant("/workspace/home");

  const dismissSeedancePromo = useCallback(() => {
    setShowSeedancePromo(false);
    try {
      sessionStorage.setItem(SEEDANCE_PROMO_DISMISS_KEY, "1");
    } catch {
      // noop
    }
  }, []);

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
      toast.error(t("home.channel.error"), {
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
  if (!hasOperationalContext && !channelsLoading && !sessionsLoading) {
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

          {budgetBannerRouteVariant === "inline" &&
          shouldShowPrompt &&
          budgetStatus !== "healthy" ? (
            <BudgetWarningBanner
              status={budgetStatus}
              dismissible={bannerDismissible}
              onDismiss={dismissBanner}
            />
          ) : null}

          {/* ═══ MIDDLE: Channels — default open, Feishu highlighted ═══ */}
          <div className="card card-static overflow-visible">
            <div className="px-5 pt-4 pb-3">
              <span className="text-[12px] font-medium text-text-primary">
                Choose a channel to get started
              </span>
            </div>
            <div className="px-5 pb-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {ONBOARDING_CHANNELS.map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      if (ch.id === "wechat") {
                        setWechatQrOpen(true);
                      } else if (ch.id === "telegram") {
                        setTelegramOpen(true);
                      } else if (ch.id === "whatsapp") {
                        setWhatsappOpen(true);
                      } else if (ch.id === "dingtalk") {
                        setDingtalkOpen(true);
                      } else if (ch.id === "qqbot") {
                        setQqbotOpen(true);
                      } else if (ch.id === "wecom") {
                        setWecomOpen(true);
                      } else {
                        setModalChannel(
                          ch.id as "feishu" | "slack" | "discord",
                        );
                      }
                    }}
                    className={`group relative rounded-xl border px-3 py-3 text-left transition-all cursor-pointer active:scale-[0.98] border-border bg-surface-0 hover:border-border-hover hover:bg-surface-1 ${
                      ch.recommended ? "animate-breathe" : ""
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center border border-border bg-white shrink-0">
                        {homeChannelIcon(ch)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-text-primary">
                          {ch.name}
                        </div>
                        <div className="mt-0.5 text-[11px] text-text-muted">
                          Add nexu Bot
                        </div>
                      </div>
                      <Cable
                        size={13}
                        className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0 mt-0.5"
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {showSeedancePromo ? (
            <SeedancePromoBanner
              isDismissed={false}
              onOpen={() => setSeedancePromoOpen(true)}
              onDismiss={dismissSeedancePromo}
            />
          ) : null}
        </div>
        {modalChannel && (
          <ChannelConnectModal
            channelType={modalChannel}
            onClose={() => setModalChannel(null)}
            onConnected={handleConnected}
            onConnectedChannelCreated={handleChannelCreated}
          />
        )}

        {wechatQrOpen && (
          <WechatQrModal
            onClose={() => setWechatQrOpen(false)}
            onConnected={() => {
              setWechatQrOpen(false);
              handleConnected();
            }}
            gatewayReady={runtimeData?.status === "active"}
          />
        )}

        {telegramOpen && (
          <TelegramModal
            onClose={() => setTelegramOpen(false)}
            onConnected={() => {
              setTelegramOpen(false);
              void handleConnected();
            }}
          />
        )}

        {whatsappOpen && (
          <WhatsappModal
            onClose={() => setWhatsappOpen(false)}
            onConnected={() => {
              setWhatsappOpen(false);
              void handleConnected();
            }}
          />
        )}
        {budgetBannerDebugPanel}

        {qqbotOpen && (
          <QqbotModal
            onClose={() => setQqbotOpen(false)}
            onConnected={() => {
              setQqbotOpen(false);
              void handleConnected();
            }}
          />
        )}

        {dingtalkOpen && (
          <DingtalkModal
            onClose={() => setDingtalkOpen(false)}
            onConnected={() => {
              setDingtalkOpen(false);
              void handleConnected();
            }}
          />
        )}

        {wecomOpen && (
          <WecomModal
            onClose={() => setWecomOpen(false)}
            onConnected={() => {
              setWecomOpen(false);
              void handleConnected();
            }}
          />
        )}

        <SeedancePromoModal
          open={seedancePromoOpen}
          onClose={() => setSeedancePromoOpen(false)}
          shouldAutoAdvanceAfterStar={false}
        />
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════════
     Scene B: Operational — Channels connected (Running state)
     ══════════════════════════════════════════════════════════════════════ */
  return (
    <div className="h-full overflow-y-auto">
      <div
        className="max-w-4xl mx-auto px-4 sm:px-6 pb-6 sm:pb-8 space-y-6"
        style={{ paddingTop: isDesktopClient ? "2rem" : "1.5rem" }}
      >
        {/* ═══ TOP: Hero — Bot running (horizontal layout) ═══ */}
        <div className="flex items-center gap-4">
          <div
            className="relative w-28 h-28 cursor-default shrink-0"
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
              <GitHubStarCta
                label={t("home.starGithub")}
                stars={stars}
                variant="inline"
                className="ml-auto shrink-0"
                onClick={() =>
                  track("workspace_github_click", { source: "home_card" })
                }
              />
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

        {budgetBannerRouteVariant === "inline" &&
        shouldShowPrompt &&
        budgetStatus !== "healthy" ? (
          <BudgetWarningBanner
            status={budgetStatus}
            dismissible={bannerDismissible}
            onDismiss={dismissBanner}
          />
        ) : null}

        {showSeedancePromo ? (
          <SeedancePromoBanner
            isDismissed={false}
            onOpen={() => setSeedancePromoOpen(true)}
            onDismiss={dismissSeedancePromo}
          />
        ) : null}

        {/* ═══ MIDDLE: Channels panel ═══ */}
        <div className="card card-static">
          <div className="px-5 pt-4 pb-3">
            <h2 className="text-[14px] font-semibold text-text-primary">
              Channels
            </h2>
          </div>
          <div className="px-5 pb-5 space-y-3">
            {/* Connected channels — full width rows with green dot */}
            {CHANNEL_OPTIONS.filter((ch) => effectiveConnectedTypes.has(ch.id))
              .length > 0 && (
              <div className="space-y-1.5">
                {CHANNEL_OPTIONS.filter((ch) =>
                  effectiveConnectedTypes.has(ch.id),
                ).map((ch) => {
                  const connectedChannel = activeChannels.find(
                    (c) => c.channelType === ch.id,
                  );
                  const statusEntry = connectedChannel
                    ? liveStatusByChannelId.get(connectedChannel.id)
                    : liveStatusByChannelType.get(ch.id);
                  const actionableChannelId =
                    connectedChannel?.id ?? statusEntry?.channelId;
                  const isPendingChannel =
                    actionableChannelId === pendingChannelId;
                  const effectiveStatus: ChannelLiveStatus | undefined =
                    isPendingChannel &&
                    (!statusEntry || statusEntry.status === "disconnected")
                      ? "connecting"
                      : statusEntry?.status;
                  const statusMeta = getChannelStatusMeta(effectiveStatus, t);
                  const isConnectedLive = effectiveStatus === "connected";
                  const channelChatUrl = connectedChannel
                    ? getChannelChatUrl(
                        ch.id,
                        connectedChannel.appId,
                        connectedChannel.botUserId,
                        connectedChannel.accountId,
                      )
                    : "";
                  const handleOpenChannel = () => {
                    const channel = normalizeChannel(ch.id);
                    if (!channelChatUrl || !channel) {
                      return;
                    }
                    track("workspace_chat_in_im_click", {
                      channel,
                      where: "home",
                    });
                    window.open(
                      channelChatUrl,
                      "_blank",
                      "noopener,noreferrer",
                    );
                  };

                  return (
                    <div
                      key={ch.id}
                      role={channelChatUrl ? "button" : undefined}
                      tabIndex={channelChatUrl ? 0 : undefined}
                      className="flex w-full items-center gap-3 rounded-xl border border-border bg-white px-4 py-3 text-left transition-all hover:bg-surface-1"
                      onClick={handleOpenChannel}
                      onKeyDown={(event) => {
                        if (!channelChatUrl) {
                          return;
                        }
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          handleOpenChannel();
                        }
                      }}
                    >
                      <div className="w-8 h-8 rounded-[10px] flex items-center justify-center border border-border bg-white shrink-0">
                        {homeChannelIcon(ch)}
                      </div>
                      <div className="flex-1 min-w-0 flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-text-primary">
                          {ch.name}
                        </span>
                        <span
                          title={statusMeta.label}
                          className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusMeta.colorClass} ${statusMeta.pulse ? "animate-pulse" : ""}`}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label={
                          isConnectedLive
                            ? t("home.disconnect")
                            : statusMeta.label
                        }
                        title={
                          isConnectedLive
                            ? t("home.disconnect")
                            : statusMeta.label
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          if (actionableChannelId) {
                            const channel = normalizeChannel(ch.id);
                            track("workspace_channel_disconnect_click", {
                              channel: channel ?? ch.id,
                            });
                            disconnectChannel.mutate(actionableChannelId);
                          }
                        }}
                        disabled={
                          disconnectChannel.isPending || !actionableChannelId
                        }
                        className="group rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium bg-surface-2 text-text-secondary hover:text-[var(--color-danger)] hover:bg-surface-3 transition-colors shrink-0 disabled:opacity-50"
                      >
                        {isConnectedLive ? (
                          <>
                            <span
                              className="group-hover:hidden"
                              aria-hidden="true"
                            >
                              {statusMeta.label}
                            </span>
                            <span
                              className="hidden group-hover:inline"
                              aria-hidden="true"
                            >
                              {t("home.disconnect")}
                            </span>
                          </>
                        ) : (
                          statusMeta.label
                        )}
                      </button>
                      {ch.id !== "wechat" && channelChatUrl && (
                        <a
                          href={channelChatUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          onClickCapture={() => {
                            const channel = normalizeChannel(ch.id);
                            if (!channel) {
                              return;
                            }
                            track("workspace_chat_in_im_click", {
                              channel,
                              where: "home",
                            });
                          }}
                          className="inline-flex items-center gap-1 text-[12px] font-medium text-text-secondary hover:text-text-primary transition-colors ml-3 shrink-0 leading-none"
                        >
                          {t("home.chat")}
                          <ArrowUpRight size={12} className="-mt-px" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Not-yet-connected channels — dashed border grid */}
            {CHANNEL_OPTIONS.filter((ch) => !effectiveConnectedTypes.has(ch.id))
              .length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CHANNEL_OPTIONS.filter(
                  (ch) => !effectiveConnectedTypes.has(ch.id),
                ).map((ch) => (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      const channel = normalizeChannel(ch.id);
                      if (channel) {
                        track("workspace_channel_connect_click", { channel });
                      }
                      if (ch.id === "wechat") {
                        setWechatQrOpen(true);
                      } else if (ch.id === "telegram") {
                        setTelegramOpen(true);
                      } else if (ch.id === "whatsapp") {
                        setWhatsappOpen(true);
                      } else if (ch.id === "dingtalk") {
                        setDingtalkOpen(true);
                      } else if (ch.id === "qqbot") {
                        setQqbotOpen(true);
                      } else if (ch.id === "wecom") {
                        setWecomOpen(true);
                      } else {
                        setModalChannel(
                          ch.id as "feishu" | "slack" | "discord",
                        );
                      }
                    }}
                    className="group flex items-center gap-2.5 rounded-lg border border-dashed border-border bg-surface-0 px-3 py-2 text-left hover:border-solid hover:border-border-hover hover:bg-surface-1 transition-all"
                  >
                    <div className="w-6 h-6 rounded-md flex items-center justify-center bg-surface-1 shrink-0">
                      {homeChannelIcon(ch, "compact")}
                    </div>
                    <span className="text-[12px] font-medium text-text-muted group-hover:text-text-secondary flex-1 truncate">
                      {ch.name}
                    </span>
                    <Cable
                      size={12}
                      className="text-text-muted group-hover:text-text-primary transition-colors shrink-0"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Activity Feed */}
        <ActivityFeed />

        <GitHubStarCta
          label={t("home.starNexu")}
          description={t("home.starCta")}
          badgeLabel="GitHub"
          stars={stars}
          variant="banner"
          onClick={() =>
            track("workspace_github_click", { source: "home_card" })
          }
        />
      </div>
      {modalChannel && (
        <ChannelConnectModal
          channelType={modalChannel}
          onClose={() => setModalChannel(null)}
          onConnected={handleConnected}
          onConnectedChannelCreated={handleChannelCreated}
        />
      )}

      {wechatQrOpen && (
        <WechatQrModal
          onClose={() => setWechatQrOpen(false)}
          onConnected={() => {
            setWechatQrOpen(false);
            handleConnected();
          }}
        />
      )}

      {telegramOpen && (
        <TelegramModal
          onClose={() => setTelegramOpen(false)}
          onConnected={() => {
            setTelegramOpen(false);
            void handleConnected();
          }}
        />
      )}

      {whatsappOpen && (
        <WhatsappModal
          onClose={() => setWhatsappOpen(false)}
          onConnected={() => {
            setWhatsappOpen(false);
            void handleConnected();
          }}
        />
      )}
      {budgetBannerDebugPanel}

      {qqbotOpen && (
        <QqbotModal
          onClose={() => setQqbotOpen(false)}
          onConnected={() => {
            setQqbotOpen(false);
            void handleConnected();
          }}
        />
      )}

      {dingtalkOpen && (
        <DingtalkModal
          onClose={() => setDingtalkOpen(false)}
          onConnected={() => {
            setDingtalkOpen(false);
            void handleConnected();
          }}
        />
      )}

      {wecomOpen && (
        <WecomModal
          onClose={() => setWecomOpen(false)}
          onConnected={() => {
            setWecomOpen(false);
            void handleConnected();
          }}
        />
      )}

      <SeedancePromoModal
        open={seedancePromoOpen}
        onClose={() => setSeedancePromoOpen(false)}
        shouldAutoAdvanceAfterStar={!hasChannel}
      />
    </div>
  );
}

function BudgetBannerDebugPanel({
  actualStatus,
  mode,
  onModeChange,
}: {
  actualStatus: BudgetBannerStatus;
  mode: BudgetBannerDebugMode;
  onModeChange: (mode: BudgetBannerDebugMode) => void;
}) {
  const options: Array<{
    label: string;
    value: BudgetBannerDebugMode;
  }> = [
    { label: "真实状态", value: "actual" },
    { label: "预警", value: "warning" },
    { label: "耗尽", value: "depleted" },
  ];

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40">
      <div className="pointer-events-auto w-[220px] rounded-2xl border border-border bg-white/95 p-3 shadow-[0_20px_60px_rgba(15,23,42,0.16)] backdrop-blur">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
          Budget Debug
        </div>
        <div className="mt-1 text-[12px] text-text-secondary">
          当前真实状态：{actualStatus}
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {options.map((option) => {
            const active = mode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onModeChange(option.value)}
                className={
                  active
                    ? "rounded-lg bg-[#111317] px-2 py-2 text-[12px] font-medium text-white transition"
                    : "rounded-lg border border-border bg-surface-1 px-2 py-2 text-[12px] font-medium text-text-secondary transition hover:border-border-hover hover:bg-surface-2"
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── WeChat QR Modal ──────────────────────────────────────

function WechatQrModal({
  onClose,
  onConnected,
  gatewayReady,
}: {
  onClose: () => void;
  onConnected: () => void;
  gatewayReady?: boolean;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is supplementary to Escape key */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* biome-ignore lint/a11y/useSemanticElements: custom modal without native dialog */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md mx-4 rounded-2xl border border-border bg-surface-0 shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 pr-2">
            <div className="w-8 h-8 shrink-0 rounded-lg flex items-center justify-center border border-border bg-surface-1">
              <WechatIcon size={24} />
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-text-primary">
                {t("wechatSetup.title")}
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-text-muted line-clamp-1">
                {t("wechatSetup.desc")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface-2 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-4 pt-1 pb-5">
          <WechatSetupView
            onConnected={onConnected}
            gatewayReady={gatewayReady}
            showHeader={false}
          />
        </div>
      </div>
    </div>
  );
}

function useModalDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const previousActiveElement =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const getFocusableElements = () => {
      const dialog = dialogRef.current;
      if (!dialog) {
        return [] as HTMLElement[];
      }
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("disabled"));
    };

    const getFocusBoundary = () => {
      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        return null;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) {
        return null;
      }

      return { firstElement, lastElement };
    };

    const focusableElements = getFocusableElements();
    const initialFocusTarget = focusableElements[0] ?? dialogRef.current;
    initialFocusTarget?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusBoundary = getFocusBoundary();
      if (!focusBoundary) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const { firstElement, lastElement } = focusBoundary;
      const activeElement =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;

      if (event.shiftKey) {
        if (
          activeElement === firstElement ||
          activeElement === dialogRef.current
        ) {
          event.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return dialogRef;
}

function TelegramModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useModalDialog(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is supplementary to Escape key */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <dialog
        open
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[560px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div
            id={titleId}
            className="text-[14px] font-semibold text-text-primary"
          >
            {t("telegramSetup.title")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.closeDialog")}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          <TelegramSetupView onConnected={onConnected} />
        </div>
      </dialog>
    </div>
  );
}

function WhatsappModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useModalDialog(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is supplementary to Escape key */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <dialog
        open
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[560px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div
            id={titleId}
            className="text-[14px] font-semibold text-text-primary"
          >
            {t("whatsappSetup.title")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.closeDialog")}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          <WhatsappSetupView onConnected={onConnected} />
        </div>
      </dialog>
    </div>
  );
}

function QqbotModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useModalDialog(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is supplementary to Escape key */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <dialog
        open
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[560px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div
            id={titleId}
            className="text-[14px] font-semibold text-text-primary"
          >
            {t("qqbotSetup.title")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.closeDialog")}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          <QqbotSetupView onConnected={onConnected} />
        </div>
      </dialog>
    </div>
  );
}

function DingtalkModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useModalDialog(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is supplementary to Escape key */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <dialog
        open
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[560px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div
            id={titleId}
            className="text-[14px] font-semibold text-text-primary"
          >
            {t("dingtalkSetup.title")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.closeDialog")}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          <DingtalkSetupView onConnected={onConnected} />
        </div>
      </dialog>
    </div>
  );
}

function WecomModal({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useModalDialog(onClose);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is supplementary to Escape key */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <dialog
        open
        ref={dialogRef}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative w-full max-w-[560px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div
            id={titleId}
            className="text-[14px] font-semibold text-text-primary"
          >
            {t("wecomSetup.title")}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.closeDialog")}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">
          <WecomSetupView onConnected={onConnected} />
        </div>
      </dialog>
    </div>
  );
}
