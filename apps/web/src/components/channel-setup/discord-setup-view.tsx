import { Input } from "@/components/ui/input";
import { formatChannelConnectErrorMessage } from "@/lib/channel-connect-errors";
import { identify, track } from "@/lib/tracking";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  Loader2,
  Lock,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { postApiV1ChannelsDiscordConnect } from "../../../lib/api/sdk.gen";

const DISCORD_SETUP_STEP_KEYS = [
  "discordSetup.stepCreateApp",
  "discordSetup.stepConfigureBot",
  "discordSetup.stepPermissions",
  "discordSetup.stepCredentials",
];

const DISCORD_INTENTS = [
  { name: "MESSAGE CONTENT", desc: "Read message content in channels" },
  { name: "SERVER MEMBERS", desc: "Access server member list" },
];

const DISCORD_SCOPES = [
  { scope: "bot", desc: "Add bot user to server" },
  { scope: "applications.commands", desc: "Register slash commands" },
];

const DISCORD_BOT_PERMISSIONS = [
  "Send Messages",
  "Read Message History",
  "Embed Links",
  "Attach Files",
  "Add Reactions",
  "Use Slash Commands",
];

export interface DiscordSetupViewProps {
  /** Called when Discord is successfully connected */
  onConnected: () => void;
  /** Layout variant — "page" uses full width, "modal" constrains width */
  variant?: "page" | "modal";
  /** Disable all connect actions (e.g. quota exceeded) */
  disabled?: boolean;
}

export function DiscordSetupView({
  onConnected,
  variant = "page",
  disabled,
}: DiscordSetupViewProps) {
  const { t } = useTranslation();
  const [activeStep, setActiveStep] = useState(0);
  const [appId, setAppId] = useState("");
  const [botToken, setBotToken] = useState("");
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { data, error } = await postApiV1ChannelsDiscordConnect({
        body: { botToken: botToken.trim(), appId: appId.trim() },
      });
      if (error) {
        track("workspace_channel_config_submit", {
          channel: "discord",
          success: false,
        });
        toast.error(
          formatChannelConnectErrorMessage(
            error,
            t("discordSetup.connectFailed"),
          ),
        );
        return;
      }
      track("workspace_channel_config_submit", {
        channel: "discord",
        success: true,
      });
      toast.success(
        t("discordSetup.connectSuccess", { teamName: data?.teamName ?? "" }),
      );
      track("channel_ready", {
        channel: "discord",
        channel_type: "discord_token",
      });
      identify({ channels_connected: 1 });
      onConnected();
    } catch {
      track("workspace_channel_config_submit", {
        channel: "discord",
        success: false,
      });
      toast.error(t("discordSetup.connectFailed"));
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className={variant === "modal" ? "" : ""}>
      {/* Step indicator */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
        {DISCORD_SETUP_STEP_KEYS.map((key, i) => (
          <button
            type="button"
            key={key}
            onClick={() => setActiveStep(i)}
            className="text-left cursor-pointer"
          >
            <div
              className={`h-1 rounded-full transition-all ${
                i <= activeStep ? "bg-[#5865F2]" : "bg-border"
              }`}
            />
            <div
              className={`text-[11px] font-semibold mt-2 transition-all ${
                i === activeStep
                  ? "text-[#5865F2]"
                  : i < activeStep
                    ? "text-text-secondary"
                    : "text-text-muted/50"
              }`}
            >
              {t("discordSetup.step", { number: i + 1 })}
            </div>
            <div
              className={`text-[10px] mt-0.5 leading-tight transition-all ${
                i === activeStep ? "text-text-secondary" : "text-text-muted/40"
              }`}
            >
              {t(key)}
            </div>
          </button>
        ))}
      </div>

      {/* Step 1: Create App */}
      {activeStep === 0 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#5865F2]/10 text-[12px] font-bold text-[#5865F2] shrink-0">
              1
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("discordSetup.createTitle")}
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                {t("discordSetup.createDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-3">
            <div className="space-y-2">
              {[
                t("discordSetup.createStep1"),
                t("discordSetup.createStep2"),
                t("discordSetup.createStep3"),
                t("discordSetup.createStep4"),
              ].map((item, i) => (
                <div key={item} className="flex gap-2.5 items-start">
                  <div className="flex justify-center items-center w-5 h-5 rounded-full bg-surface-3 text-[9px] font-bold text-text-muted shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <a
              href="https://discord.com/developers/applications"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex gap-1.5 items-center px-3.5 py-2 text-[12px] font-medium rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-border-hover hover:bg-surface-3 transition-all"
            >
              <ExternalLink size={12} />
              {t("discordSetup.openPortal")}
            </a>
          </div>
        </div>
      )}

      {/* Step 2: Configure Bot */}
      {activeStep === 1 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#5865F2]/10 text-[12px] font-bold text-[#5865F2] shrink-0">
              2
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("discordSetup.configureBotTitle")}
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                {t("discordSetup.configureBotDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <div className="space-y-2">
              {[
                t("discordSetup.botStep1"),
                t("discordSetup.botStep2"),
                t("discordSetup.botStep3"),
              ].map((item, i) => (
                <div key={item} className="flex gap-2.5 items-start">
                  <div className="flex justify-center items-center w-5 h-5 rounded-full bg-surface-3 text-[9px] font-bold text-text-muted shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3.5 py-2.5 bg-surface-3 border-b border-border">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                  {t("discordSetup.requiredIntents")}
                </span>
              </div>
              {DISCORD_INTENTS.map((intent, i) => (
                <div
                  key={intent.name}
                  className={`flex items-center gap-3 px-3.5 py-2.5 ${
                    i < DISCORD_INTENTS.length - 1
                      ? "border-b border-border"
                      : ""
                  }`}
                >
                  <div className="w-7 h-4 rounded-full bg-[#5865F2] relative shrink-0">
                    <div className="absolute right-0.5 top-0.5 w-3 h-3 rounded-full bg-white" />
                  </div>
                  <code className="text-[11px] font-mono text-[#5865F2] font-medium">
                    {intent.name}
                  </code>
                  <span className="text-[11px] text-text-muted ml-auto">
                    {intent.desc}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Permissions */}
      {activeStep === 2 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#5865F2]/10 text-[12px] font-bold text-[#5865F2] shrink-0">
              3
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("discordSetup.permissionsTitle")}
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                {t("discordSetup.permissionsDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3.5 py-2.5 bg-surface-3 border-b border-border">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                  {t("discordSetup.oauthScopes")}
                </span>
              </div>
              {DISCORD_SCOPES.map((s, i) => (
                <div
                  key={s.scope}
                  className={`flex items-center gap-3 px-3.5 py-2.5 ${
                    i < DISCORD_SCOPES.length - 1
                      ? "border-b border-border"
                      : ""
                  }`}
                >
                  <CheckCircle2
                    size={12}
                    className="text-[var(--color-success)] shrink-0"
                  />
                  <code className="text-[11px] font-mono text-[#5865F2] bg-[#5865F2]/8 px-1.5 py-0.5 rounded font-medium">
                    {s.scope}
                  </code>
                  <span className="text-[11px] text-text-muted">{s.desc}</span>
                </div>
              ))}
            </div>
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3.5 py-2.5 bg-surface-3 border-b border-border">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                  {t("discordSetup.botPermissions")}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 p-3.5">
                {DISCORD_BOT_PERMISSIONS.map((perm) => (
                  <div key={perm} className="flex gap-1.5 items-center">
                    <CheckCircle2
                      size={10}
                      className="text-[var(--color-success)] shrink-0"
                    />
                    <span className="text-[11px] text-text-muted">{perm}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="text-[11px] text-text-muted leading-relaxed">
              {t("discordSetup.installLinkHint")}
            </p>
          </div>
        </div>
      )}

      {/* Step 4: Credentials */}
      {activeStep === 3 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#5865F2]/10 text-[12px] font-bold text-[#5865F2] shrink-0">
              4
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                {t("discordSetup.credentialsTitle")}
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                {t("discordSetup.credentialsDesc")}
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <div>
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <label
                  htmlFor="discord-app-id"
                  className="text-[12px] text-text-primary font-medium"
                >
                  {t("discordSetup.appIdLabel")}
                </label>
                <span className="text-[11px] text-text-muted">
                  {t("discordSetup.appIdHint")}
                </span>
              </div>
              <Input
                id="discord-app-id"
                type="text"
                placeholder="e.g. 1234567890123456789"
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                className="text-[13px] font-mono"
              />
            </div>
            <div>
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <label
                  htmlFor="discord-bot-token"
                  className="text-[12px] text-text-primary font-medium"
                >
                  {t("discordSetup.botTokenLabel")}
                </label>
                <span className="text-[11px] text-text-muted">
                  {t("discordSetup.botTokenHint")}
                </span>
              </div>
              <div className="relative">
                <Input
                  id="discord-bot-token"
                  type="password"
                  placeholder="e.g. MTxxxxxxxxxxxxxxxxxxxxxxx.xxxxxx"
                  value={botToken}
                  onChange={(e) => setBotToken(e.target.value)}
                  className="text-[13px] font-mono pr-9"
                />
                <Lock
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted/40"
                />
              </div>
            </div>
            <button
              type="button"
              onClick={handleConnect}
              disabled={
                disabled || connecting || !appId.trim() || !botToken.trim()
              }
              className="flex gap-1.5 items-center px-5 py-2.5 text-[13px] font-medium text-white rounded-lg bg-[#5865F2] hover:bg-[#4752C4] transition-all disabled:opacity-60 cursor-pointer"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check size={14} />
              )}
              {t("discordSetup.verifyConnect")}
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center mt-5">
        <button
          type="button"
          onClick={() => setActiveStep(Math.max(0, activeStep - 1))}
          disabled={activeStep === 0}
          className="flex gap-1.5 items-center text-[12px] text-text-muted hover:text-text-secondary transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
        >
          <ArrowLeft size={13} />
          {t("discordSetup.previous")}
        </button>
        {activeStep < DISCORD_SETUP_STEP_KEYS.length - 1 && (
          <button
            type="button"
            onClick={() => setActiveStep(activeStep + 1)}
            className="flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-[#5865F2] hover:bg-[#4752C4] transition-all cursor-pointer"
          >
            {t("discordSetup.next")}
            <ChevronRight size={13} />
          </button>
        )}
      </div>

      {/* Help link */}
      <div className="flex gap-3 items-center p-4 mt-5 rounded-xl border bg-surface-1 border-border">
        <BookOpen size={14} className="text-[#5865F2] shrink-0" />
        <p className="text-[11px] text-text-muted leading-relaxed">
          {t("discordSetup.helpText")}{" "}
          <a
            href="https://discord.com/developers/docs/getting-started"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#5865F2] hover:underline underline-offset-2 font-medium"
          >
            {t("discordSetup.helpLinkText")}
          </a>{" "}
          {t("discordSetup.helpSuffix")}
        </p>
      </div>
    </div>
  );
}
