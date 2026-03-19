import { DiscordSetupView } from "@/components/channel-setup/discord-setup-view";
import { FeishuSetupView } from "@/components/channel-setup/feishu-setup-view";
import { SlackOAuthView } from "@/components/channel-setup/slack-oauth-view";
import { useBotQuota } from "@/hooks/use-bot-quota";
import { useCountdown } from "@/hooks/use-countdown";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  Key,
  Link2,
  Loader2,
  RotateCcw,
  Shield,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import {
  deleteApiV1ChannelsByChannelId,
  getApiV1Channels,
} from "../../lib/api/sdk.gen";

type Platform = "slack" | "discord" | "feishu";

const PLATFORMS: { id: Platform; emoji: string; desc: string }[] = [
  { id: "slack", emoji: "#", desc: "Workspace Bot" },
  { id: "discord", emoji: "\u{1F3AE}", desc: "Server Bot" },
  { id: "feishu", emoji: "\u{1F426}", desc: "Feishu Bot" },
];

const PLATFORM_LABELS: Record<Platform, string> = {
  slack: "Slack",
  discord: "Discord",
  feishu: "Feishu",
};

// ─── Main page ───────────────────────────────────────────────

export function ChannelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [platform, setPlatform] = useState<Platform>("slack");
  const [forceGuide, setForceGuide] = useState(false);

  // Auto-enter manual Slack flow when redirected from OAuth error (run once on mount)
  const slackManual = searchParams.get("slackManual") === "true";
  const slackError = searchParams.get("slackError") || undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally run once on mount to consume URL params
  useEffect(() => {
    if (slackManual || slackError) {
      setPlatform("slack");
      setForceGuide(false);
      const next = new URLSearchParams(searchParams);
      next.delete("slackManual");
      next.delete("slackError");
      setSearchParams(next, { replace: true });
    }
  }, []);

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await getApiV1Channels();
      return data;
    },
  });

  const { available: quotaAvailable, resetsAt } = useBotQuota();

  const channels = channelsData?.channels ?? [];
  const currentChannel = channels.find((ch) => ch.channelType === platform);
  const isConfigured = !!currentChannel;
  const quotaLimited = !quotaAvailable;
  const showGuide = !isConfigured || forceGuide;

  const handlePlatformChange = (p: Platform) => {
    setPlatform(p);
    setForceGuide(false);
  };

  const handleConnected = () => {
    queryClient.invalidateQueries({ queryKey: ["channels"] });
  };

  return (
    <div className="px-4 py-4 sm:px-6 sm:py-6 md:p-8 mx-auto max-w-4xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-text-primary">
          {t("channels.pageTitle")}
        </h1>
        <p className="text-[13px] text-text-muted mt-1">
          {t("channels.pageSubtitle")}
        </p>
      </div>

      {/* Platform selector */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
        {PLATFORMS.map((p) => {
          const isActive = platform === p.id;
          const connected = channels.some((ch) => ch.channelType === p.id);
          return (
            <button
              type="button"
              key={p.id}
              onClick={() => handlePlatformChange(p.id)}
              className={`relative flex items-center gap-3 px-4 py-3.5 rounded-xl text-left transition-all cursor-pointer ${
                isActive
                  ? "bg-accent/5 border-2 border-accent/40 shadow-sm"
                  : "bg-surface-1 border border-border hover:border-border-hover hover:bg-surface-2"
              }`}
            >
              <div
                className={`flex justify-center items-center w-9 h-9 rounded-lg shrink-0 ${
                  isActive ? "bg-accent/10" : "bg-surface-3"
                }`}
              >
                <span className="text-sm">{p.emoji}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[13px] font-semibold ${isActive ? "text-accent" : "text-text-primary"}`}
                >
                  {PLATFORM_LABELS[p.id]}
                </div>
                <div className="text-[10px] text-text-muted mt-0.5">
                  {p.desc}
                </div>
              </div>
              {connected ? (
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
              ) : (
                <Circle size={14} className="text-text-muted/30 shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Coming soon */}
      <div className="flex gap-1.5 items-center mb-4 text-[11px] text-text-muted flex-wrap">
        <Zap size={10} className="text-accent" />
        {t("channels.comingSoon")}
      </div>

      {quotaLimited && !isConfigured && <QuotaBanner resetsAt={resetsAt} />}

      {/* Back button when force-viewing guide for configured platform */}
      {isConfigured && forceGuide && (
        <button
          type="button"
          onClick={() => setForceGuide(false)}
          className="flex gap-1.5 items-center mb-5 text-[12px] text-accent font-medium hover:underline underline-offset-2"
        >
          <ArrowLeft size={13} /> {t("channels.backToConfig")}
        </button>
      )}

      {/* Content */}
      {showGuide ? (
        platform === "slack" ? (
          <SlackOAuthView
            onConnected={handleConnected}
            initialManual={slackManual}
            oauthError={slackError}
            disabled={quotaLimited}
          />
        ) : platform === "discord" ? (
          <DiscordSetupView
            onConnected={handleConnected}
            disabled={quotaLimited}
          />
        ) : (
          <FeishuSetupView
            onConnected={handleConnected}
            disabled={quotaLimited}
          />
        )
      ) : currentChannel ? (
        <ConfiguredView
          platform={platform}
          channel={currentChannel}
          queryClient={queryClient}
          onShowGuide={() => setForceGuide(true)}
        />
      ) : null}
    </div>
  );
}

// ─── Configured View ─────────────────────────────────────────

function ConfiguredView({
  platform,
  channel,
  queryClient,
  onShowGuide,
}: {
  platform: Platform;
  channel: {
    id: string;
    accountId: string;
    teamName: string | null;
    appId?: string | null;
    botUserId?: string | null;
    status: string;
    createdAt?: string | null;
  };
  queryClient: ReturnType<typeof useQueryClient>;
  onShowGuide: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await deleteApiV1ChannelsByChannelId({
        path: { channelId: channel.id },
      });
      if (error) {
        const errorMessage =
          typeof error === "object" && error !== null && "message" in error
            ? String(error.message)
            : "Disconnect failed";
        throw new Error(errorMessage);
      }
    },
    onSuccess: () => {
      setShowResetConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      toast.success(`${PLATFORM_LABELS[platform]} disconnected`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Extract teamId from accountId (format: "slack-{appId}-{teamId}")
  const slackTeamId =
    platform === "slack"
      ? channel.accountId.replace(/^slack-[^-]+-/, "")
      : null;

  const handleOpenSlack = useCallback(() => {
    const teamId = slackTeamId;
    const botUser = channel.botUserId;

    // Build native app and web URLs
    const nativeUrl =
      teamId && botUser
        ? `slack://user?team=${teamId}&id=${botUser}`
        : teamId
          ? `slack://open?team=${teamId}`
          : null;
    const webUrl =
      teamId && botUser
        ? `https://app.slack.com/client/${teamId}/messages/${botUser}`
        : teamId
          ? `https://app.slack.com/client/${teamId}`
          : null;

    if (!nativeUrl || !webUrl) return;

    // Try native app first. If the app opens, the browser loses focus
    // and we cancel the fallback. Otherwise open the web URL after 5s.
    const fallbackTimer = setTimeout(() => {
      window.open(webUrl, "_blank", "noopener,noreferrer");
    }, 5000);
    const cancelFallback = () => {
      clearTimeout(fallbackTimer);
      window.removeEventListener("blur", cancelFallback);
    };
    window.addEventListener("blur", cancelFallback);
    window.location.href = nativeUrl;
  }, [slackTeamId, channel.botUserId]);

  const webhookUrl = `${window.location.origin}/api/${platform}/events`;
  const discordInviteUrl = channel.appId
    ? `https://discord.com/oauth2/authorize?client_id=${channel.appId}&scope=bot&permissions=8`
    : null;

  return (
    <>
      <div className="space-y-4 sm:space-y-5">
        {/* Status banner */}
        <div className="flex flex-col items-start gap-3 p-4 rounded-xl border bg-emerald-500/5 border-emerald-500/15 sm:flex-row sm:items-center">
          <div className="flex justify-center items-center w-9 h-9 rounded-lg bg-emerald-500/10 shrink-0">
            <CheckCircle2 size={18} className="text-emerald-500" />
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-text-primary">
              {t("channels.statusConnected", {
                platform: PLATFORM_LABELS[platform],
              })}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              {channel.teamName ?? channel.accountId}
              {channel.createdAt &&
                ` \u00B7 ${t("channels.configuredDate", { date: new Date(channel.createdAt).toLocaleDateString() })}`}
              {" \u00B7 "}
              {t("channels.connectionActive")}
            </div>
          </div>
          <button
            type="button"
            onClick={onShowGuide}
            className="flex gap-1.5 items-center px-3 py-1.5 text-[11px] text-text-muted rounded-lg border border-border hover:border-border-hover hover:text-text-secondary transition-all shrink-0"
          >
            <BookOpen size={11} /> {t("channels.setupGuide")}
          </button>
        </div>

        {/* Discord: Add Bot to Server */}
        {platform === "discord" && discordInviteUrl && (
          <div className="p-5 rounded-xl border bg-surface-1 border-border">
            <div className="flex gap-2 items-center mb-4">
              <div className="flex justify-center items-center w-7 h-7 rounded-lg bg-indigo-500/10 shrink-0">
                <ExternalLink size={13} className="text-indigo-500" />
              </div>
              <h3 className="text-[13px] font-semibold text-text-primary">
                {t("channels.addToServer")}
              </h3>
            </div>
            <p className="text-[12px] text-text-muted mb-3 leading-relaxed">
              {t("channels.addToServerDesc")}
            </p>
            <a
              href={discordInviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-accent hover:bg-accent-hover transition-all"
            >
              <ExternalLink size={13} /> {t("channels.addBotToServer")}
            </a>
          </div>
        )}

        {/* Slack: Open in Slack */}
        {platform === "slack" && slackTeamId && (
          <div className="p-5 rounded-xl border bg-surface-1 border-border">
            <div className="flex gap-2 items-center mb-4">
              <div className="flex justify-center items-center w-7 h-7 rounded-lg bg-blue-500/10 shrink-0">
                <ExternalLink size={13} className="text-blue-500" />
              </div>
              <h3 className="text-[13px] font-semibold text-text-primary">
                {t("channels.openInSlack")}
              </h3>
            </div>
            <p className="text-[12px] text-text-muted mb-3 leading-relaxed">
              {channel.botUserId
                ? t("channels.openSlackDM")
                : t("channels.openSlackWorkspace")}
            </p>
            <button
              type="button"
              onClick={handleOpenSlack}
              className="inline-flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-accent hover:bg-accent-hover transition-all"
            >
              <ExternalLink size={13} />{" "}
              {channel.botUserId
                ? t("channels.messageBotSlack")
                : t("channels.openWorkspace")}
            </button>
          </div>
        )}

        {/* Feishu: Open in Feishu */}
        {platform === "feishu" && channel.appId && (
          <div className="p-5 rounded-xl border bg-surface-1 border-border">
            <div className="flex gap-2 items-center mb-4">
              <div className="flex justify-center items-center w-7 h-7 rounded-lg bg-[#3370FF]/10 shrink-0">
                <ExternalLink size={13} className="text-[#3370FF]" />
              </div>
              <h3 className="text-[13px] font-semibold text-text-primary">
                {t("channels.openInFeishu")}
              </h3>
            </div>
            <p className="text-[12px] text-text-muted mb-3 leading-relaxed">
              {t("channels.openFeishuDM")}
            </p>
            <a
              href={`https://applink.feishu.cn/client/bot/open?appId=${channel.appId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-[#3370FF] hover:bg-[#2860E6] transition-all"
            >
              <ExternalLink size={13} /> {t("channels.messageBotFeishu")}
            </a>
          </div>
        )}

        {/* Slack: Webhook URL */}
        {platform === "slack" && (
          <div className="p-5 rounded-xl border bg-surface-1 border-border">
            <div className="flex gap-2 items-center mb-4">
              <div className="flex justify-center items-center w-7 h-7 rounded-lg bg-blue-500/10 shrink-0">
                <Link2 size={13} className="text-blue-500" />
              </div>
              <h3 className="text-[13px] font-semibold text-text-primary">
                {t("channels.webhookUrl")}
              </h3>
            </div>
            <div className="flex gap-2 items-center p-3 rounded-lg border bg-surface-0 border-border font-mono text-[12px]">
              <code className="flex-1 break-all text-text-secondary">
                {webhookUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopy(webhookUrl)}
                className="p-1.5 rounded-lg transition-all text-text-muted hover:text-text-primary hover:bg-surface-3 shrink-0"
                title="Copy"
              >
                {copied ? (
                  <Check size={13} className="text-emerald-500" />
                ) : (
                  <Copy size={13} />
                )}
              </button>
            </div>
          </div>
        )}

        {/* Credentials */}
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-2 items-center mb-4">
            <div className="flex justify-center items-center w-7 h-7 rounded-lg bg-amber-500/10 shrink-0">
              <Key size={13} className="text-amber-500" />
            </div>
            <h3 className="text-[13px] font-semibold text-text-primary">
              {t("channels.credentials")}
            </h3>
          </div>
          <div className="space-y-3">
            <div>
              <span className="text-[11px] text-text-muted font-medium mb-1.5 block">
                {t("channels.accountId")}
              </span>
              <div className="px-3 py-2.5 w-full text-[13px] rounded-lg border border-border bg-surface-0 text-text-secondary">
                {channel.accountId}
              </div>
            </div>
            {channel.teamName && (
              <div>
                <span className="text-[11px] text-text-muted font-medium mb-1.5 block">
                  {platform === "discord"
                    ? t("channels.serverName")
                    : t("channels.teamName")}
                </span>
                <div className="px-3 py-2.5 w-full text-[13px] rounded-lg border border-border bg-surface-0 text-text-secondary">
                  {channel.teamName}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Danger zone */}
        <div className="p-5 rounded-xl border border-border bg-surface-1">
          <div className="flex gap-2 items-center mb-3">
            <div className="flex justify-center items-center w-7 h-7 rounded-lg bg-red-500/10 shrink-0">
              <Shield size={13} className="text-red-400" />
            </div>
            <h3 className="text-[13px] font-semibold text-text-primary">
              {t("channels.resetConfig")}
            </h3>
          </div>
          <p className="text-[12px] text-text-muted mb-3.5 leading-relaxed">
            {t("channels.resetConfigDesc", {
              platform: PLATFORM_LABELS[platform],
            })}
          </p>
          <button
            type="button"
            onClick={() => setShowResetConfirm(true)}
            disabled={disconnectMutation.isPending}
            className="flex gap-1.5 items-center px-3.5 py-2 text-[12px] font-medium text-red-500 rounded-lg border border-red-500/20 hover:bg-red-500/5 hover:border-red-500/30 transition-all disabled:opacity-60"
          >
            {disconnectMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCcw size={12} />
            )}
            {t("channels.resetReconfigure")}
          </button>
        </div>
      </div>

      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
          onClick={() =>
            !disconnectMutation.isPending && setShowResetConfirm(false)
          }
          onKeyDown={(e) => {
            if (e.key === "Escape" && !disconnectMutation.isPending) {
              setShowResetConfirm(false);
            }
          }}
        >
          <div
            className="w-full max-w-[420px] rounded-2xl border border-border bg-surface-1 shadow-xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/10 shrink-0">
                  <Shield size={14} className="text-red-500" />
                </div>
                <div>
                  <h3 className="text-[14px] font-semibold text-text-primary">
                    {t("channels.confirmReset")}
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {t("channels.confirmResetDesc", {
                      platform: PLATFORM_LABELS[platform],
                    })}
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="text-[12px] text-text-secondary leading-relaxed">
                {t("channels.confirmResetBody", {
                  platform: PLATFORM_LABELS[platform],
                })}
              </p>
              <div className="mt-4 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  disabled={disconnectMutation.isPending}
                  className="px-3.5 py-2 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-3 transition-all disabled:opacity-60"
                >
                  {t("channels.cancel")}
                </button>
                <button
                  type="button"
                  onClick={() => disconnectMutation.mutate()}
                  disabled={disconnectMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium text-white rounded-lg bg-red-500 hover:bg-red-600 transition-all disabled:opacity-60"
                >
                  {disconnectMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw size={12} />
                  )}
                  {t("channels.confirmReset")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Quota Banner ─────────────────────────────────────────

function QuotaBanner({ resetsAt }: { resetsAt: string }) {
  const { t } = useTranslation();
  const countdown = useCountdown(resetsAt);
  return (
    <div className="flex gap-3 items-start p-4 rounded-xl border bg-red-500/5 border-red-500/15 mb-6">
      <Clock size={16} className="mt-0.5 shrink-0 text-red-500" />
      <div>
        <div className="text-[13px] font-medium text-text-primary">
          {t("channels.quotaTitle")}
        </div>
        <p className="text-[12px] text-text-primary mt-0.5 leading-relaxed">
          {t("channels.quotaBody", { countdown })}
        </p>
      </div>
    </div>
  );
}
