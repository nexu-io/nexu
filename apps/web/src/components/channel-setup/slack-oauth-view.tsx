import { Input } from "@/components/ui/input";
import { identify, track } from "@/lib/tracking";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Lock,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getApiV1ChannelsSlackOauthUrl,
  getApiV1ChannelsSlackRedirectUri,
  postApiV1ChannelsSlackConnect,
} from "../../../lib/api/sdk.gen";

const SLACK_SCOPES = [
  { scope: "app_mentions:read", desc: "Receive @mention events" },
  { scope: "assistant:write", desc: "Enable streaming & typing indicators" },
  { scope: "channels:history", desc: "Read channel messages" },
  { scope: "channels:read", desc: "List channels" },
  { scope: "chat:write", desc: "Send messages" },
  { scope: "groups:history", desc: "Read private channel messages" },
  { scope: "groups:read", desc: "List private channels" },
  { scope: "im:history", desc: "Read DM messages" },
  { scope: "im:read", desc: "Read DM info" },
  { scope: "im:write", desc: "Open direct messages" },
  { scope: "mpim:history", desc: "Read group DM messages" },
  { scope: "mpim:read", desc: "Read group DM info" },
  { scope: "reactions:write", desc: "Add processing indicator reactions" },
  { scope: "files:read", desc: "Access files shared in channels" },
  { scope: "files:write", desc: "Upload files and images" },
  { scope: "users:read", desc: "Resolve user info" },
  { scope: "users.profile:read", desc: "Read user profile details" },
];

const SLACK_MANUAL_STEPS = [
  { title: "Signing Secret" },
  { title: "Add Scopes" },
  { title: "Bot Token" },
  { title: "Configure Events" },
];

const SLACK_LOGO_PATH =
  "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.124 2.521a2.528 2.528 0 0 1 2.52-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.271 0a2.528 2.528 0 0 1-2.521 2.521 2.528 2.528 0 0 1-2.521-2.521V2.522A2.528 2.528 0 0 1 15.166 0a2.528 2.528 0 0 1 2.521 2.522v6.312zm-2.521 10.124a2.528 2.528 0 0 1 2.521 2.52A2.528 2.528 0 0 1 15.166 24a2.528 2.528 0 0 1-2.521-2.522v-2.52h2.521zm0-1.271a2.528 2.528 0 0 1-2.521-2.521 2.528 2.528 0 0 1 2.521-2.521h6.312A2.528 2.528 0 0 1 24 15.166a2.528 2.528 0 0 1-2.522 2.521h-6.312z";

export interface SlackOAuthViewProps {
  /** Called when Slack is successfully connected */
  onConnected: () => void;
  /** Layout variant — "page" uses full width, "modal" constrains width */
  variant?: "page" | "modal";
  /** Start directly in manual mode */
  initialManual?: boolean;
  /** OAuth returnTo path (e.g. "/onboarding?openModal=slack") */
  oauthReturnTo?: string;
  /** Error message from a failed OAuth attempt (passed via query param) */
  oauthError?: string;
}

export function SlackOAuthView({
  onConnected,
  variant = "page",
  initialManual,
  oauthReturnTo,
  oauthError,
}: SlackOAuthViewProps) {
  const [phase, setPhase] = useState<"install" | "authorizing" | "manual">(
    initialManual ? "manual" : "install",
  );
  const [activeStep, setActiveStep] = useState(0);
  const [copied, setCopied] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [oauthFailed, setOauthFailed] = useState(!!oauthError);
  const [oauthErrorMsg, setOauthErrorMsg] = useState(oauthError || "");
  const [eventsUrl, setEventsUrl] = useState(
    `${window.location.origin}/api/slack/events`,
  );

  // Fetch server base URL so the events URL matches the actual deployment
  useEffect(() => {
    getApiV1ChannelsSlackRedirectUri()
      .then(({ data }) => {
        if (data?.redirectUri) {
          const base = data.redirectUri.replace(
            /\/api\/oauth\/slack\/callback$/,
            "",
          );
          setEventsUrl(`${base}/api/slack/events`);
        }
      })
      .catch(() => {});
  }, []);

  // Detect return from failed OAuth via browser back button
  useEffect(() => {
    const markFailed = () => {
      setOauthFailed(true);
      setOauthErrorMsg("Authorization was not completed");
      setPhase("manual");
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted && sessionStorage.getItem("slack_oauth_pending")) {
        sessionStorage.removeItem("slack_oauth_pending");
        markFailed();
      }
    };

    if (sessionStorage.getItem("slack_oauth_pending")) {
      sessionStorage.removeItem("slack_oauth_pending");
      markFailed();
    }

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddToSlack = async () => {
    setPhase("authorizing");
    try {
      const { data, error } = await getApiV1ChannelsSlackOauthUrl({
        query: oauthReturnTo ? { returnTo: oauthReturnTo } : undefined,
      });
      if (error) {
        toast.error(error.message ?? "Failed to get Slack OAuth URL");
        setPhase("install");
        return;
      }
      if (data?.url) {
        sessionStorage.setItem("slack_oauth_pending", "true");
        window.location.href = data.url;
      }
    } catch {
      toast.error("Failed to start Slack connection");
      setPhase("install");
    }
  };

  const handleManualConnect = async () => {
    setConnecting(true);
    try {
      const { data, error } = await postApiV1ChannelsSlackConnect({
        body: {
          botToken: botToken.trim(),
          signingSecret: signingSecret.trim(),
        },
      });
      if (error) {
        toast.error(error.message ?? "Failed to connect Slack");
        return;
      }
      toast.success(`Slack workspace "${data?.teamName ?? ""}" connected!`);
      track("channel_ready", { channel: "slack" });
      identify({ channels_connected: 1 });
      onConnected();
    } catch {
      toast.error("Failed to connect Slack");
    } finally {
      setConnecting(false);
    }
  };

  const wrapperClass = variant === "modal" ? "" : "max-w-md mx-auto";
  const manualWrapperClass = variant === "modal" ? "" : "max-w-2xl";

  // Phase 1: Install (OAuth-first)
  if (phase === "install") {
    return (
      <div className={wrapperClass}>
        <div className="p-8 rounded-xl border bg-surface-1 border-border text-center">
          <div className="flex justify-center items-center w-12 h-12 rounded-xl bg-[#4A154B]/10 mx-auto mb-5">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="#4A154B"
              role="img"
              aria-label="Slack logo"
            >
              <title>Slack logo</title>
              <path d={SLACK_LOGO_PATH} />
            </svg>
          </div>
          <h3 className="text-[15px] font-semibold text-text-primary mb-1">
            Add Nexu to Slack
          </h3>
          <p className="text-[12px] text-text-muted mb-6 leading-relaxed max-w-[300px] mx-auto">
            One-click install — authorize Nexu Bot to your Slack workspace via
            OAuth
          </p>
          <button
            type="button"
            onClick={handleAddToSlack}
            className="flex gap-2 items-center justify-center mx-auto px-6 py-3 text-[13px] font-medium text-white rounded-lg bg-[#4A154B] hover:bg-[#3a1039] transition-all cursor-pointer"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="white"
              aria-hidden="true"
            >
              <path d={SLACK_LOGO_PATH} />
            </svg>
            Add to Slack
          </button>
          <button
            type="button"
            onClick={() => setPhase("manual")}
            className="mt-4 text-[12px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          >
            Or connect manually
          </button>
        </div>
      </div>
    );
  }

  // Phase 2: Authorizing (brief flash before redirect)
  if (phase === "authorizing") {
    return (
      <div className={wrapperClass}>
        <div className="p-8 rounded-xl border bg-surface-1 border-border text-center">
          <div className="flex justify-center items-center w-12 h-12 rounded-xl bg-[#4A154B]/10 mx-auto mb-5">
            <div className="w-5 h-5 border-2 border-[#4A154B]/30 border-t-[#4A154B] rounded-full animate-spin" />
          </div>
          <h3 className="text-[15px] font-semibold text-text-primary mb-1">
            Authorizing...
          </h3>
          <p className="text-[12px] text-text-muted leading-relaxed">
            Connecting to your Slack workspace
          </p>
        </div>
      </div>
    );
  }

  // Phase 3: Manual fallback flow
  return (
    <div className={manualWrapperClass}>
      {/* Error / info banner */}
      <div
        className={`flex gap-3 items-start p-4 rounded-xl border mb-5 ${
          oauthFailed
            ? "bg-red-500/5 border-red-500/15"
            : "bg-amber-500/5 border-amber-500/15"
        }`}
      >
        <AlertCircle
          size={16}
          className={`mt-0.5 shrink-0 ${oauthFailed ? "text-red-500" : "text-amber-500"}`}
        />
        <div>
          <div className="text-[13px] font-medium text-text-primary">
            {oauthFailed ? "OAuth authorization failed" : "Manual connection"}
          </div>
          <p className="text-[12px] text-text-muted mt-0.5 leading-relaxed">
            {oauthFailed
              ? oauthErrorMsg ||
                "The automatic Slack authorization was not completed."
              : "Enter your existing Slack App credentials below to connect manually."}{" "}
            You can try OAuth again or use the manual flow below.
          </p>
          <button
            type="button"
            onClick={() => {
              setOauthFailed(false);
              setOauthErrorMsg("");
              setPhase("install");
            }}
            className="mt-2 text-[12px] font-medium text-[#4A154B] hover:underline underline-offset-2 cursor-pointer"
          >
            Try OAuth again
          </button>
        </div>
      </div>

      {/* Step indicator */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {SLACK_MANUAL_STEPS.map((s, i) => (
          <button
            type="button"
            key={s.title}
            onClick={() => setActiveStep(i)}
            className="text-left cursor-pointer"
          >
            <div
              className={`h-1 rounded-full transition-all ${
                i <= activeStep ? "bg-[#4A154B]" : "bg-border"
              }`}
            />
            <div
              className={`text-[11px] font-semibold mt-2 transition-all ${
                i === activeStep
                  ? "text-[#4A154B]"
                  : i < activeStep
                    ? "text-text-secondary"
                    : "text-text-muted/50"
              }`}
            >
              Step {i + 1}
            </div>
            <div
              className={`text-[10px] mt-0.5 leading-tight transition-all ${
                i === activeStep ? "text-text-secondary" : "text-text-muted/40"
              }`}
            >
              {s.title}
            </div>
          </button>
        ))}
      </div>

      {/* Step 1: Signing Secret */}
      {activeStep === 0 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#4A154B]/10 text-[12px] font-bold text-[#4A154B] shrink-0">
              1
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                Copy your Signing Secret
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                Open your Slack App Dashboard → go to{" "}
                <span className="font-medium text-text-secondary">
                  Basic Information → App Credentials
                </span>{" "}
                → copy the Signing Secret and paste it below.
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-4">
            <a
              href="https://api.slack.com/apps"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex gap-1.5 items-center px-3.5 py-2 text-[12px] font-medium rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-border-hover hover:bg-surface-3 transition-all"
            >
              <ExternalLink size={12} />
              Open Slack App Dashboard
            </a>
            <div>
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <label
                  htmlFor="slack-signing-secret"
                  className="text-[12px] text-text-primary font-medium"
                >
                  Signing Secret
                </label>
              </div>
              <div className="relative">
                <Input
                  id="slack-signing-secret"
                  type="password"
                  placeholder="a1bc2d3e4f5..."
                  value={signingSecret}
                  onChange={(e) => setSigningSecret(e.target.value)}
                  className="text-[13px] font-mono pr-9"
                />
                <Lock
                  size={13}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted/40"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Add Scopes */}
      {activeStep === 1 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#4A154B]/10 text-[12px] font-bold text-[#4A154B] shrink-0">
              2
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                Add Bot Token Scopes
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                Go to{" "}
                <span className="font-medium text-text-secondary">
                  OAuth & Permissions
                </span>{" "}
                → scroll to Bot Token Scopes → add all the scopes below. This
                must be done before installing the app.
              </p>
            </div>
          </div>
          <div className="ml-11">
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="px-3.5 py-2.5 bg-surface-3 border-b border-border">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">
                  Required Scopes
                </span>
              </div>
              {SLACK_SCOPES.map((s, i) => (
                <div
                  key={s.scope}
                  className={`flex items-center gap-3 px-3.5 py-2.5 ${
                    i < SLACK_SCOPES.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <CheckCircle2
                    size={12}
                    className="text-emerald-500 shrink-0"
                  />
                  <code className="text-[11px] font-mono text-[#4A154B] bg-[#4A154B]/8 px-1.5 py-0.5 rounded font-medium">
                    {s.scope}
                  </code>
                  <span className="text-[11px] text-text-muted">{s.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Install & Get Bot Token */}
      {activeStep === 2 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#4A154B]/10 text-[12px] font-bold text-[#4A154B] shrink-0">
              3
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                Install app & copy Bot Token
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                Still on{" "}
                <span className="font-medium text-text-secondary">
                  OAuth & Permissions
                </span>{" "}
                — click &quot;Install to Workspace&quot; at the top, authorize,
                then find the token under{" "}
                <span className="font-medium text-text-secondary">
                  OAuth Tokens
                </span>
                .
              </p>
            </div>
          </div>
          <div className="ml-11">
            <div>
              <div className="flex items-baseline gap-1.5 mb-1.5">
                <label
                  htmlFor="slack-bot-token"
                  className="text-[12px] text-text-primary font-medium"
                >
                  Bot User OAuth Token
                </label>
              </div>
              <div className="relative">
                <Input
                  id="slack-bot-token"
                  type="password"
                  placeholder="xoxb-..."
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
          </div>
        </div>
      )}

      {/* Step 4: Configure Events */}
      {activeStep === 3 && (
        <div className="p-5 rounded-xl border bg-surface-1 border-border">
          <div className="flex gap-3 items-start mb-4">
            <div className="flex justify-center items-center w-8 h-8 rounded-lg bg-[#4A154B]/10 text-[12px] font-bold text-[#4A154B] shrink-0">
              4
            </div>
            <div>
              <h3 className="text-[14px] font-semibold text-text-primary">
                Configure Event Subscriptions
              </h3>
              <p className="text-[12px] text-text-muted mt-1 leading-relaxed">
                Set the Request URL in your Slack App →{" "}
                <span className="font-medium text-text-secondary">
                  Event Subscriptions
                </span>
              </p>
            </div>
          </div>
          <div className="ml-11 space-y-3">
            <div className="flex gap-2 items-center p-3 rounded-lg border bg-surface-0 border-border font-mono text-[12px]">
              <code className="flex-1 break-all text-text-secondary">
                {eventsUrl}
              </code>
              <button
                type="button"
                onClick={() => handleCopy(eventsUrl)}
                className="p-1.5 rounded-lg transition-all text-text-muted hover:text-text-primary hover:bg-surface-3 shrink-0 cursor-pointer"
                title="Copy"
              >
                {copied ? (
                  <Check size={13} className="text-emerald-500" />
                ) : (
                  <Copy size={13} />
                )}
              </button>
            </div>
            <div className="space-y-2">
              {[
                <span key="1">Go to your Slack App → Event Subscriptions</span>,
                <span key="2">Toggle Enable Events to On</span>,
                <span key="3">
                  Paste the URL above into the Request URL field
                </span>,
                <span key="4">
                  Subscribe to bot events:{" "}
                  <strong className="text-text-primary">app_mention</strong>,{" "}
                  <strong className="text-text-primary">
                    message.channels
                  </strong>
                  ,{" "}
                  <strong className="text-text-primary">message.groups</strong>,{" "}
                  <strong className="text-text-primary">message.im</strong>
                </span>,
              ].map((item, idx) => (
                <div key={item.key} className="flex gap-2.5 items-start">
                  <div className="flex justify-center items-center w-5 h-5 rounded-full bg-surface-3 text-[9px] font-bold text-text-muted shrink-0 mt-0.5">
                    {idx + 1}
                  </div>
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {item}
                  </span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleManualConnect}
              disabled={connecting || !botToken.trim() || !signingSecret.trim()}
              className="flex gap-1.5 items-center px-5 py-2.5 text-[13px] font-medium text-white rounded-lg bg-[#4A154B] hover:bg-[#3a1039] transition-all disabled:opacity-60 cursor-pointer mt-4"
            >
              {connecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check size={14} />
              )}
              Connect
            </button>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center mt-5">
        <button
          type="button"
          onClick={() =>
            activeStep === 0
              ? setPhase("install")
              : setActiveStep(activeStep - 1)
          }
          className="flex gap-1.5 items-center text-[12px] text-text-muted hover:text-text-secondary transition-all cursor-pointer"
        >
          <ArrowLeft size={13} />
          {activeStep === 0 ? "Back" : "Previous"}
        </button>
        {activeStep < SLACK_MANUAL_STEPS.length - 1 && (
          <button
            type="button"
            onClick={() => setActiveStep(activeStep + 1)}
            className="flex gap-1.5 items-center px-4 py-2 text-[12px] font-medium text-white rounded-lg bg-[#4A154B] hover:bg-[#3a1039] transition-all cursor-pointer"
          >
            Next
            <ChevronRight size={13} />
          </button>
        )}
      </div>

      {/* Help link */}
      <div className="flex gap-3 items-center p-4 mt-5 rounded-xl border bg-surface-1 border-border">
        <BookOpen size={14} className="text-[#4A154B] shrink-0" />
        <p className="text-[11px] text-text-muted leading-relaxed">
          Need help? Read the{" "}
          <a
            href="https://api.slack.com/authentication/basics"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#4A154B] hover:underline underline-offset-2 font-medium"
          >
            Slack Authentication Guide
          </a>{" "}
          for detailed instructions.
        </p>
      </div>
    </div>
  );
}
