import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { identify, track } from "@/lib/tracking";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Copy,
  ExternalLink,
  HelpCircle,
  Key,
  Link2,
  Loader2,
  RotateCcw,
  Shield,
  Smartphone,
  Zap,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import "@/lib/api";
import { whatsappQrImageUrl, whatsappWaMeUrl } from "@/lib/whatsapp";
import {
  deleteV1ChannelsByChannelId,
  getV1Channels,
  getV1ChannelsSlackOauthUrl,
  postV1ChannelsDiscordConnect,
  postV1ChannelsSlackConnect,
} from "../../lib/api/sdk.gen";

type Platform = "slack" | "discord" | "whatsapp";

const PLATFORMS: { id: Platform; emoji: string; desc: string }[] = [
  { id: "slack", emoji: "#", desc: "Workspace Bot" },
  { id: "discord", emoji: "🎮", desc: "Server Bot" },
  { id: "whatsapp", emoji: "💬", desc: "Business API" },
];

const PLATFORM_LABELS: Record<Platform, string> = {
  slack: "Slack",
  discord: "Discord",
  whatsapp: "WhatsApp",
};

type DetailItem = string | { text: string; url: string };

interface StepDef {
  step: number;
  title: string;
  desc: string;
  detail?: DetailItem[];
  detail2?: DetailItem[];
  copyable?: string;
  hasInputs?: boolean;
}

function renderBold(text: string) {
  const parts = text.split(/(\*\*.+?\*\*)/g);
  if (parts.length === 1) return text;
  const result: ReactNode[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as string;
    if (part.startsWith("**") && part.endsWith("**")) {
      result.push(
        <strong key={i} className="font-semibold text-text-primary">
          {part.slice(2, -2)}
        </strong>,
      );
    } else {
      result.push(<span key={i}>{part}</span>);
    }
  }
  return result;
}

const DISCORD_STEPS: StepDef[] = [
  {
    step: 1,
    title: "Create Discord Application",
    desc: "Go to the Discord Developer Portal and create a new application.",
    detail: [
      {
        text: "Discord Developer Portal",
        url: "https://discord.com/developers/applications",
      },
      'Click **"New Application"**',
      "Set the App Name to **Nexu**",
      "Save and navigate to the **Bot** page",
    ],
  },
  {
    step: 2,
    title: "Configure Bot Permissions",
    desc: "Enable Privileged Gateway Intents on the Bot page.",
    detail: [
      "Go to Application → **Bot**",
      "**Enable** the following Intents:",
      "  · MESSAGE CONTENT INTENT — read message content",
      "  · SERVER MEMBERS INTENT — read member information",
    ],
  },
  {
    step: 3,
    title: "Enter Credentials",
    desc: "Enter the Bot Token and Application ID from your Discord Application below.",
    hasInputs: true,
  },
  {
    step: 4,
    title: "Invite & Test",
    desc: "Add the Bot to your Discord server, then mention @Nexu to test.",
    detail: [
      "Click the button below to invite the bot to your server",
      "Select the server and **authorize**",
      'Send **"@Nexu hello"** in a channel to test',
    ],
  },
];

const SLACK_STEPS: StepDef[] = [
  {
    step: 1,
    title: "Create Slack App",
    desc: "Go to the Slack API dashboard and create a new App.",
    detail: [
      { text: "Slack API Dashboard", url: "https://api.slack.com/apps" },
      'Click **"Create New App"**',
      'Select **"From scratch"**',
      "Set the App Name to **Nexu**",
      "Choose the workspace to install it to",
    ],
  },
  {
    step: 2,
    title: "Configure Bot Permissions",
    desc: "Add Bot Token Scopes under OAuth & Permissions.",
    detail: [
      "Go to App → **OAuth & Permissions**",
      'Scroll down to **"Bot Token Scopes"**',
      "**Add** the following scopes:",
      "  · chat:write — send messages",
      "  · app_mentions:read — receive @mentions",
      "  · files:read — read uploaded files",
      "  · channels:history — read channel messages",
    ],
  },
  {
    step: 3,
    title: "Install & Connect",
    desc: "Install the App to your workspace, then paste the credentials below.",
    detail: [
      "Go to App → **Install App**",
      'Click **"Install to Workspace"** and authorize',
      'After install, go to App → **OAuth & Permissions** → copy the **"Bot User OAuth Token"** (starts with xoxb-)',
      'Then go to App → **Basic Information** → **App Credentials** → copy the **"Signing Secret"**',
      "Paste both values below:",
    ],
    hasInputs: true,
  },
  {
    step: 4,
    title: "Configure Events & Test",
    desc: "Set up Event Subscriptions so Slack forwards messages to Nexu.",
    detail: [
      "Go to App → **Event Subscriptions**",
      'Toggle **"Enable Events"** on',
      "Enter the following Request URL:",
    ],
    copyable: "/api/slack/events",
    detail2: [
      'Under **"Subscribe to bot events"**, add:',
      "  · app_mention — when someone @mentions your bot",
      "  · message.channels — messages in public channels",
      'Click **"Save Changes"**',
      "In any Slack channel, type **/invite @Nexu**",
      'Send **"@Nexu hello"** to test',
    ],
  },
];

const WHATSAPP_STEPS: StepDef[] = [
  {
    step: 1,
    title: "Create Meta App",
    desc: "Go to Meta for Developers and create a new Business App.",
    detail: [
      {
        text: "Meta for Developers",
        url: "https://developers.facebook.com/apps",
      },
      'Click "Create App"',
      "Select the Business type",
      "Set the App Name to Nexu",
    ],
  },
  {
    step: 2,
    title: "Configure WhatsApp Business API",
    desc: "Add the WhatsApp product in the App Dashboard.",
    detail: [
      "Go to App → Add Products",
      'Select "WhatsApp" and click Set Up',
      "Link your Business Account",
      "Get a test number or add a production number",
    ],
  },
  {
    step: 3,
    title: "Configure Webhook",
    desc: "Set the Webhook URL so WhatsApp forwards messages to Nexu.",
    detail: [
      "Go to WhatsApp → Configuration",
      "Enter the following Callback URL:",
    ],
    copyable: "/api/whatsapp/webhook",
  },
  {
    step: 4,
    title: "Enter Credentials",
    desc: "Enter the Access Token and Phone Number ID from WhatsApp Business API below.",
    hasInputs: true,
  },
  {
    step: 5,
    title: "Send Test Message",
    desc: "Send a message to the test number to verify Nexu can send and receive.",
    detail: [
      "Go to WhatsApp → API Setup",
      "Send a message using the Test Number",
      "Confirm the message appears in Nexu",
      'Reply "hello" to test two-way communication',
    ],
  },
];

const STEPS_MAP: Record<Platform, StepDef[]> = {
  slack: SLACK_STEPS,
  discord: DISCORD_STEPS,
  whatsapp: WHATSAPP_STEPS,
};

const CREDENTIAL_FIELDS: Record<
  Platform,
  {
    label1: string;
    placeholder1: string;
    hint1: string;
    label2: string;
    placeholder2: string;
    hint2: string;
  }
> = {
  discord: {
    label1: "Application ID",
    placeholder1: "123456789012345678",
    hint1: "Application → General Information → Application ID",
    label2: "Bot Token",
    placeholder2: "MTxx...",
    hint2: "Application → Bot → Reset Token, copy the generated token",
  },
  slack: {
    label1: "Bot User OAuth Token",
    placeholder1: "xoxb-xxxxxxxxxxxxx",
    hint1:
      "App → OAuth & Permissions → Bot User OAuth Token (starts with xoxb-)",
    label2: "Signing Secret",
    placeholder2: "xxxxxxxxxxxxxxxxxxxxxxx",
    hint2: "App → Basic Information → App Credentials → Signing Secret",
  },
  whatsapp: {
    label1: "Access Token",
    placeholder1: "EAAxxxxxxxxxxxxxxx",
    hint1: "App Dashboard → WhatsApp → API Setup → Temporary Access Token",
    label2: "Phone Number ID",
    placeholder2: "xxxxxxxxxxxxx",
    hint2: "App Dashboard → WhatsApp → API Setup → Phone Number ID",
  },
};

// ─── Main page ───────────────────────────────────────────────

export function ChannelsPage() {
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState<Platform>("slack");
  const [forceGuide, setForceGuide] = useState(false);

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: async () => {
      const { data } = await getV1Channels();
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

  return (
    <div className="p-8 mx-auto max-w-4xl">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-lg font-bold text-text-primary">Channels</h1>
        <p className="text-[13px] text-text-muted mt-1">
          Connect your messaging platforms and let Nexu 🦞 join your workspace
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
        platform === "whatsapp" ? (
          <WhatsAppQRView />
        ) : (
          <SetupGuideView platform={platform} queryClient={queryClient} />
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

// ─── Credential Field with hint tooltip ──────────────────────

function CredentialField({
  label,
  hint,
  placeholder,
  type = "text",
  value,
  onChange,
}: {
  label: string;
  hint: string;
  placeholder: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-[11px] text-text-muted font-medium">
          {label}
        </Label>
        <div className="relative group">
          <HelpCircle
            size={12}
            className="text-text-muted/50 hover:text-text-secondary cursor-help transition-colors"
          />
          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-3 py-2 rounded-lg bg-[#1a1a1a] text-white text-[11px] leading-relaxed whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity shadow-lg z-30">
            {hint}
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-[#1a1a1a]" />
          </div>
        </div>
      </div>
      <Input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[13px]"
      />
    </div>
  );
}

// ─── Setup Guide ─────────────────────────────────────────────

function SetupGuideView({
  platform,
  queryClient,
}: {
  platform: Platform;
  queryClient: ReturnType<typeof useQueryClient>;
}) {
  const [currentStep, setCurrentStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const steps = STEPS_MAP[platform];
  const activeStep = steps[currentStep];
  if (!activeStep) return null;
  const fields = CREDENTIAL_FIELDS[platform];

  // Credential state
  const [field1, setField1] = useState("");
  const [field2, setField2] = useState("");

  const [oauthLoading, setOauthLoading] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Discord connect
  const discordConnect = useMutation({
    mutationFn: async () => {
      const { data, error } = await postV1ChannelsDiscordConnect({
        body: { botToken: field2, appId: field1 },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      toast.success("Discord connected!");
      track("channel_ready", { channel: "discord" });
      identify({ channels_connected: 1 });
      setCurrentStep((prev) => prev + 1);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Slack manual connect
  const slackConnect = useMutation({
    mutationFn: async () => {
      const { data, error } = await postV1ChannelsSlackConnect({
        body: {
          botToken: field1,
          signingSecret: field2,
        },
      });
      if (error) throw new Error(error.message);
      return data;
    },
    onSuccess: () => {
      toast.success("Slack connected!");
      track("channel_ready", { channel: "slack" });
      identify({ channels_connected: 1 });
      setCurrentStep((prev) => prev + 1);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const handleSlackOAuth = async () => {
    setOauthLoading(true);
    try {
      const { data, error } = await getV1ChannelsSlackOauthUrl();
      if (error) {
        toast.error(error.message ?? "Failed to get Slack OAuth URL");
        return;
      }
      if (data?.url) window.location.href = data.url;
    } catch {
      toast.error("Failed to start Slack connection");
    } finally {
      setOauthLoading(false);
    }
  };

  const handleFinish = () => {
    if (platform === "discord") discordConnect.mutate();
    else if (platform === "slack") slackConnect.mutate();
  };

  const isPending = discordConnect.isPending || slackConnect.isPending;

  return (
    <div className="flex gap-6">
      {/* Steps sidebar */}
      <div className="w-52 shrink-0">
        <div className="p-4 rounded-xl border bg-surface-1 border-border">
          <div className="text-[11px] text-text-muted font-medium mb-3 flex items-center justify-between">
            <span>Setup Steps</span>
            <span className="text-accent">~3 min</span>
          </div>
          <div className="space-y-0.5">
            {steps.map((s, i) => (
              <button
                type="button"
                key={s.step}
                onClick={() => setCurrentStep(i)}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-all cursor-pointer ${
                  i === currentStep
                    ? "bg-accent/10 text-accent"
                    : i < currentStep
                      ? "text-text-secondary hover:bg-surface-3"
                      : "text-text-muted hover:bg-surface-3"
                }`}
              >
                <div
                  className={`w-[22px] h-[22px] rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    i < currentStep
                      ? "bg-accent text-white"
                      : i === currentStep
                        ? "bg-accent/15 text-accent"
                        : "bg-surface-3 text-text-muted"
                  }`}
                >
                  {i < currentStep ? <Check size={11} /> : s.step}
                </div>
                <span className="text-[12px] font-medium truncate">
                  {s.title}
                </span>
              </button>
            ))}
          </div>

          {/* Slack OAuth shortcut */}
          {platform === "slack" && (
            <div className="mt-4 pt-3 border-t border-border">
              <Button
                className="w-full text-[12px]"
                size="sm"
                onClick={handleSlackOAuth}
                disabled={oauthLoading}
              >
                {oauthLoading ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Install via OAuth
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 min-w-0">
        <div className="p-6 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-5">
            <div className="flex justify-center items-center w-9 h-9 rounded-lg shrink-0 bg-accent/10">
              <span className="text-sm font-bold text-accent">
                {activeStep.step}
              </span>
            </div>
            <div>
              <h3 className="text-[15px] font-semibold text-text-primary">
                {activeStep.title}
              </h3>
              <p className="mt-1 text-[13px] text-text-muted leading-relaxed">
                {activeStep.desc}
              </p>
            </div>
          </div>

          {activeStep.detail && (
            <div className="ml-12 space-y-2 mb-5">
              {activeStep.detail.map((d) => {
                if (typeof d === "object") {
                  return (
                    <div
                      key={d.url}
                      className="text-[13px] text-text-secondary leading-relaxed"
                    >
                      <span className="flex gap-2.5 items-start">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent/40 shrink-0" />
                        <span>
                          Open{" "}
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline underline-offset-2"
                          >
                            {d.text} ↗
                          </a>
                        </span>
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={d}
                    className="text-[13px] text-text-secondary leading-relaxed"
                  >
                    {d.startsWith("  ") ? (
                      <span className="ml-4 text-text-muted font-mono text-[12px]">
                        {d.trim()}
                      </span>
                    ) : (
                      <span className="flex gap-2.5 items-start">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent/40 shrink-0" />
                        {renderBold(d)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {platform === "discord" &&
            activeStep.step === steps.length &&
            field1.trim() && (
              <div className="mb-5 ml-12">
                <a
                  href={`https://discord.com/oauth2/authorize?client_id=${field1}&scope=bot&permissions=68608`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-[#5865F2] hover:bg-[#4752C4] transition-all"
                >
                  <ExternalLink size={13} /> Add Bot to Server
                </a>
              </div>
            )}

          {activeStep.copyable &&
            (() => {
              const copyable = activeStep.copyable as string;
              const fullUrl = copyable.startsWith("/")
                ? `${window.location.origin}${copyable}`
                : copyable;
              return (
                <div className="mb-5 ml-12">
                  <div className="flex gap-2 items-center p-3 rounded-lg border bg-surface-0 border-border font-mono text-[12px]">
                    <code className="flex-1 break-all text-text-secondary">
                      {fullUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => handleCopy(fullUrl)}
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
              );
            })()}

          {activeStep.detail2 && (
            <div className="ml-12 space-y-2 mb-5">
              {activeStep.detail2.map((d) => {
                if (typeof d === "object") {
                  return (
                    <div
                      key={d.url}
                      className="text-[13px] text-text-secondary leading-relaxed"
                    >
                      <span className="flex gap-2.5 items-start">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent/40 shrink-0" />
                        <span>
                          Open{" "}
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:underline underline-offset-2"
                          >
                            {d.text} ↗
                          </a>
                        </span>
                      </span>
                    </div>
                  );
                }
                return (
                  <div
                    key={d}
                    className="text-[13px] text-text-secondary leading-relaxed"
                  >
                    {d.startsWith("  ") ? (
                      <span className="ml-4 text-text-muted font-mono text-[12px]">
                        {d.trim()}
                      </span>
                    ) : (
                      <span className="flex gap-2.5 items-start">
                        <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent/40 shrink-0" />
                        {renderBold(d)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {activeStep.hasInputs && (
            <div className="mb-5 ml-12 space-y-3">
              <CredentialField
                label={fields.label1}
                hint={fields.hint1}
                placeholder={fields.placeholder1}
                value={field1}
                onChange={setField1}
              />
              <CredentialField
                label={fields.label2}
                hint={fields.hint2}
                placeholder={fields.placeholder2}
                type="password"
                value={field2}
                onChange={setField2}
              />
            </div>
          )}

          {/* Navigation */}
          <div className="flex justify-between items-center pt-4 mt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
              disabled={currentStep === 0}
              className="px-4 py-2 text-[12px] font-medium text-text-secondary rounded-lg border border-border hover:border-border-hover hover:bg-surface-3 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            {activeStep.hasInputs ? (
              <button
                type="button"
                onClick={handleFinish}
                disabled={isPending || !field1.trim() || !field2.trim()}
                className="flex gap-1 items-center px-5 py-2 text-[12px] font-medium text-white rounded-lg transition-all bg-accent hover:bg-accent-hover disabled:opacity-60"
              >
                {isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check size={13} />
                )}
                Connect
              </button>
            ) : currentStep < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setCurrentStep(currentStep + 1)}
                className="flex gap-1 items-center px-5 py-2 text-[12px] font-medium text-white rounded-lg transition-all bg-accent hover:bg-accent-hover"
              >
                Next <ChevronRight size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() =>
                  queryClient.invalidateQueries({ queryKey: ["channels"] })
                }
                className="flex gap-1 items-center px-5 py-2 text-[12px] font-medium text-white rounded-lg transition-all bg-accent hover:bg-accent-hover"
              >
                <Check size={13} />
                Done
              </button>
            )}
          </div>
        </div>

        {/* Help tip */}
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

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const { error } = await deleteV1ChannelsByChannelId({
        path: { channelId: channel.id },
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["channels"] });
      toast.success(`${PLATFORM_LABELS[platform]} disconnected`);
    },
  });

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const webhookUrl = `${window.location.origin}/api/${platform}/events`;
  const discordInviteUrl = channel.appId
    ? `https://discord.com/oauth2/authorize?client_id=${channel.appId}&scope=bot&permissions=68608`
    : null;

  return (
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
              ` · configured ${new Date(channel.createdAt).toLocaleDateString()}`}
            {" · "}connection active
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
          onClick={() => disconnectMutation.mutate()}
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
