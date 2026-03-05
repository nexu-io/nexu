import { DiscordSetupView } from "@/components/channel-setup/discord-setup-view";
import { SlackOAuthView } from "@/components/channel-setup/slack-oauth-view";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Key,
  Link2,
  Loader2,
  RotateCcw,
  Shield,
  Smartphone,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import { whatsappQrImageUrl, whatsappWaMeUrl } from "@/lib/whatsapp";
import {
  deleteApiV1ChannelsByChannelId,
  getApiV1Channels,
} from "../../lib/api/sdk.gen";

type Platform = "slack" | "discord" | "whatsapp";

const PLATFORMS: { id: Platform; emoji: string; desc: string }[] = [
  { id: "slack", emoji: "#", desc: "Workspace Bot" },
  { id: "discord", emoji: "\u{1F3AE}", desc: "Server Bot" },
  { id: "whatsapp", emoji: "\u{1F4AC}", desc: "Business API" },
];

const PLATFORM_LABELS: Record<Platform, string> = {
  slack: "Slack",
  discord: "Discord",
  whatsapp: "WhatsApp",
};

// ─── Main page ───────────────────────────────────────────────

export function ChannelsPage() {
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

  const channels = channelsData?.channels ?? [];
  const currentChannel = channels.find((ch) => ch.channelType === platform);
  const isConfigured = !!currentChannel;
  const showGuide = !isConfigured || forceGuide;

  const handlePlatformChange = (p: Platform) => {
    setPlatform(p);
    setForceGuide(false);
  };

  const handleConnected = () => {
    queryClient.invalidateQueries({ queryKey: ["channels"] });
  };

  return (
    <div className="p-8 mx-auto max-w-4xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-text-primary">Channels</h1>
        <p className="text-[13px] text-text-muted mt-1">
          Connect your messaging platforms and let Nexu {"\u{1F99E}"} join your
          workspace
        </p>
      </div>

      {/* Platform selector */}
      <div className="grid grid-cols-3 gap-3 mb-6">
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
      <div className="flex gap-1.5 items-center mb-6 text-[11px] text-text-muted">
        <Zap size={10} className="text-accent" />
        Telegram, Microsoft Teams, Line and more coming soon
      </div>

      {/* Back button when force-viewing guide for configured platform */}
      {isConfigured && forceGuide && (
        <button
          type="button"
          onClick={() => setForceGuide(false)}
          className="flex gap-1.5 items-center mb-5 text-[12px] text-accent font-medium hover:underline underline-offset-2"
        >
          <ArrowLeft size={13} /> Back to configuration
        </button>
      )}

      {/* Content */}
      {showGuide ? (
        platform === "slack" ? (
          <SlackOAuthView
            onConnected={handleConnected}
            initialManual={slackManual}
            oauthError={slackError}
          />
        ) : platform === "whatsapp" ? (
          <WhatsAppQRView />
        ) : (
          <DiscordSetupView onConnected={handleConnected} />
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
    status: string;
    createdAt?: string | null;
  };
  queryClient: ReturnType<typeof useQueryClient>;
  onShowGuide: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await deleteApiV1ChannelsByChannelId({
        path: { channelId: channel.id },
      });
      if (error) throw new Error(error.message);
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

  const webhookUrl = `${window.location.origin}/api/${platform}/events`;
  const discordInviteUrl = channel.appId
    ? `https://discord.com/oauth2/authorize?client_id=${channel.appId}&scope=bot&permissions=8`
    : null;

  return (
    <>
      <div className="space-y-5 max-w-2xl">
        {/* Status banner */}
        <div className="flex gap-3 items-center p-4 rounded-xl border bg-emerald-500/5 border-emerald-500/15">
          <div className="flex justify-center items-center w-9 h-9 rounded-lg bg-emerald-500/10 shrink-0">
            <CheckCircle2 size={18} className="text-emerald-500" />
          </div>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-text-primary">
              {PLATFORM_LABELS[platform]} Bot Connected
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              {channel.teamName ?? channel.accountId}
              {channel.createdAt &&
                ` \u00B7 configured ${new Date(channel.createdAt).toLocaleDateString()}`}
              {" \u00B7 "}connection active
            </div>
          </div>
          <button
            type="button"
            onClick={onShowGuide}
            className="flex gap-1.5 items-center px-3 py-1.5 text-[11px] text-text-muted rounded-lg border border-border hover:border-border-hover hover:text-text-secondary transition-all shrink-0"
          >
            <BookOpen size={11} /> Setup Guide
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
                Add to Server
              </h3>
            </div>
            <p className="text-[12px] text-text-muted mb-3 leading-relaxed">
              Use the link below to invite the Bot to your Discord server.
            </p>
            <a
              href={discordInviteUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-accent hover:bg-accent-hover transition-all"
            >
              <ExternalLink size={13} /> Add Bot to Server
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
                Webhook URL
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
              Credentials
            </h3>
          </div>
          <div className="space-y-3">
            <div>
              <span className="text-[11px] text-text-muted font-medium mb-1.5 block">
                Account ID
              </span>
              <div className="px-3 py-2.5 w-full text-[13px] rounded-lg border border-border bg-surface-0 text-text-secondary">
                {channel.accountId}
              </div>
            </div>
            {channel.teamName && (
              <div>
                <span className="text-[11px] text-text-muted font-medium mb-1.5 block">
                  {platform === "discord" ? "Server Name" : "Team Name"}
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
              Reset Configuration
            </h3>
          </div>
          <p className="text-[12px] text-text-muted mb-3.5 leading-relaxed">
            This will remove the current {PLATFORM_LABELS[platform]} Bot
            configuration. You will need to complete the setup process again.
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
            Reset & Reconfigure
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
                    Confirm reset
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    {PLATFORM_LABELS[platform]} will be disconnected.
                  </p>
                </div>
              </div>
            </div>

            <div className="px-5 py-4">
              <p className="text-[12px] text-text-secondary leading-relaxed">
                This will remove your current {PLATFORM_LABELS[platform]} Bot
                configuration. You will need to complete setup again before Nexu
                can receive messages from this platform.
              </p>
              <div className="mt-4 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(false)}
                  disabled={disconnectMutation.isPending}
                  className="px-3.5 py-2 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-3 transition-all disabled:opacity-60"
                >
                  Cancel
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
                  Confirm reset
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── WhatsApp QR setup ───────────────────────────────────────

function WhatsAppQRView() {
  return (
    <div className="max-w-md mx-auto">
      <div className="p-8 rounded-xl border bg-surface-1 border-border text-center">
        <div className="flex justify-center items-center w-12 h-12 rounded-xl bg-emerald-500/10 mx-auto mb-5">
          <Smartphone size={22} className="text-emerald-500" />
        </div>
        <h3 className="text-[15px] font-semibold text-text-primary mb-1">
          Scan to connect WhatsApp
        </h3>
        <p className="text-[12px] text-text-muted mb-6 leading-relaxed">
          Open WhatsApp and scan the QR code below to start chatting with Nexu.
        </p>
        <div className="mx-auto mb-4 w-full max-w-[240px] rounded-xl border border-border bg-white p-2">
          <img
            src={whatsappQrImageUrl}
            alt="WhatsApp QR code"
            className="w-full h-auto rounded-lg"
          />
        </div>
        <a
          href={whatsappWaMeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[12px] font-medium rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 transition-colors"
        >
          Open WhatsApp
          <ExternalLink size={12} />
        </a>
        <p className="mt-3 text-[11px] text-text-muted break-all">
          <a
            href={whatsappWaMeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-secondary underline underline-offset-2"
          >
            {whatsappWaMeUrl}
          </a>
        </p>
      </div>

      <div className="flex gap-3 items-center p-4 mt-4 rounded-xl border bg-surface-1 border-border">
        <AlertCircle size={15} className="text-accent shrink-0" />
        <div className="text-[12px] text-text-muted leading-relaxed">
          <span className="font-medium text-text-secondary">Need help?</span>{" "}
          Check out the{" "}
          <a
            href="https://docs.nexu.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline underline-offset-2"
          >
            full documentation
          </a>{" "}
          or reach us on{" "}
          <a
            href="https://discord.gg/nexu"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline underline-offset-2"
          >
            Discord
          </a>
          .
        </div>
      </div>
    </div>
  );
}
