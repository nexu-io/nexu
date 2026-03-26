import { ConnectionGraphic } from "@/components/connection-graphic";
import { DiscordIcon, SlackIcon } from "@/components/platform-icons";
import { getToolkitPermissions } from "@/lib/toolkit-permissions";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ExternalLink,
  Shield,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import "@/lib/api";
import {
  getApiV1Channels,
  postApiV1IntegrationsByIntegrationIdRefresh,
} from "../../lib/api/sdk.gen";

// ─── Types ───────────────────────────────────────────────────

interface ToolkitInfo {
  toolkitSlug: string;
  toolkitDisplayName: string;
  toolkitIconUrl: string;
  toolkitFallbackIconUrl?: string;
}

interface SlackDeeplink {
  nativeUrl: string;
  webUrl: string;
}

type CallbackState =
  | ({ phase: "processing" } & Partial<ToolkitInfo>)
  | {
      phase: "success";
      source: "chat" | undefined;
      toolkitName: string;
      returnTo: string | undefined;
      toolkitSlug: string;
      toolkitIconUrl: string;
      toolkitFallbackIconUrl?: string;
      slackDeeplink?: SlackDeeplink;
      chatChannels: string[];
    }
  | { phase: "error"; message: string };

// ─── Main Page ──────────────────────────────────────────────

export function OAuthCallbackPage() {
  const { integrationId } = useParams<{ integrationId: string }>();
  const navigate = useNavigate();
  const [callbackState, setCallbackState] = useState<CallbackState>(() => {
    // Try to read toolkit info from localStorage for immediate display
    const initial: CallbackState = { phase: "processing" };
    if (!integrationId) return initial;
    try {
      const raw = localStorage.getItem(`nexu-oauth-pending-${integrationId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed.toolkitDisplayName) {
          return {
            phase: "processing",
            toolkitSlug: parsed.toolkitSlug as string,
            toolkitDisplayName: parsed.toolkitDisplayName as string,
            toolkitIconUrl: parsed.toolkitIconUrl as string,
            toolkitFallbackIconUrl: parsed.toolkitFallbackIconUrl as
              | string
              | undefined,
          };
        }
      }
    } catch {
      // localStorage unavailable — proceed with generic UI
    }
    return initial;
  });
  const processedRef = useRef(false);

  const processCallback = useCallback(async () => {
    if (!integrationId) {
      setCallbackState({
        phase: "error",
        message: "Missing integration ID",
      });
      return;
    }

    // Read state from localStorage
    let savedState: string | undefined;
    try {
      const raw = localStorage.getItem(`nexu-oauth-pending-${integrationId}`);
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: string };
        savedState = parsed.state;
      }
    } catch {
      // localStorage unavailable or corrupted — proceed without state
    }

    let attempts = 0;
    const maxAttempts = 20;
    const pollInterval = 3000;

    const poll = async (): Promise<void> => {
      attempts++;
      try {
        const { data: refreshed } =
          await postApiV1IntegrationsByIntegrationIdRefresh({
            path: { integrationId },
            body: { state: savedState },
          });

        // Update processing state with toolkit info from API (first poll)
        if (refreshed && refreshed.status !== "active") {
          setCallbackState((prev) => {
            if (prev.phase !== "processing" || prev.toolkitDisplayName)
              return prev;
            return {
              ...prev,
              toolkitSlug: refreshed.toolkit.slug,
              toolkitDisplayName: refreshed.toolkit.displayName,
              toolkitIconUrl: refreshed.toolkit.iconUrl,
              toolkitFallbackIconUrl: refreshed.toolkit.fallbackIconUrl,
            };
          });
        }

        if (refreshed?.status === "active") {
          // Clear localStorage
          try {
            localStorage.removeItem(`nexu-oauth-pending-${integrationId}`);
          } catch {
            // ignore
          }

          const source = refreshed.source;
          if (source === "chat") {
            // Fetch channel info to determine which chat platforms the user has
            let slackDeeplink: SlackDeeplink | undefined;
            let chatChannels: string[] = [];
            try {
              const { data: channelsData } = await getApiV1Channels();
              const channels = channelsData?.channels ?? [];
              chatChannels = [
                ...new Set(
                  channels.map((ch) => ch.channelType).filter((t) => !!t),
                ),
              ];

              const slackChannel = channels.find(
                (ch) => ch.channelType === "slack",
              );
              if (slackChannel) {
                const accountId = slackChannel.accountId ?? "";
                const botUserId = slackChannel.botUserId;
                const teamId = accountId.replace(/^slack-[^-]+-/, "");
                if (teamId && botUserId) {
                  slackDeeplink = {
                    nativeUrl: `slack://user?team=${teamId}&id=${botUserId}`,
                    webUrl: `https://app.slack.com/client/${teamId}/messages/${botUserId}`,
                  };
                } else if (teamId) {
                  slackDeeplink = {
                    nativeUrl: `slack://open?team=${teamId}`,
                    webUrl: `https://app.slack.com/client/${teamId}`,
                  };
                }
              }
            } catch {
              // Best effort — fall back to showing all buttons
            }

            setCallbackState({
              phase: "success",
              source: "chat",
              toolkitName: refreshed.toolkit.displayName,
              returnTo: undefined,
              toolkitSlug: refreshed.toolkit.slug,
              toolkitIconUrl: refreshed.toolkit.iconUrl,
              toolkitFallbackIconUrl: refreshed.toolkit.fallbackIconUrl,
              slackDeeplink,
              chatChannels,
            });
          } else {
            // page source or undefined — redirect
            const returnTo = refreshed.returnTo ?? "/workspace/integrations";
            navigate(returnTo, { replace: true });
          }
          return;
        }

        if (attempts >= maxAttempts) {
          setCallbackState({
            phase: "error",
            message:
              "Connection timed out. Please close this tab and try again.",
          });
          return;
        }

        // Still pending — poll again
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        return poll();
      } catch {
        setCallbackState({
          phase: "error",
          message: "Failed to verify connection. Please try again.",
        });
      }
    };

    await poll();
  }, [integrationId, navigate]);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;
    processCallback();
  }, [processCallback]);

  // ─── Render ──────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-surface-0 flex items-center justify-center">
      <div className="w-full max-w-sm mx-4">
        {callbackState.phase === "processing" && (
          <ProcessingCard state={callbackState} />
        )}
        {callbackState.phase === "success" && (
          <SuccessCard state={callbackState} />
        )}
        {callbackState.phase === "error" && (
          <ErrorCard message={callbackState.message} />
        )}
      </div>
    </div>
  );
}

// ─── Processing Card ────────────────────────────────────────

function ProcessingCard({
  state,
}: {
  state: Extract<CallbackState, { phase: "processing" }>;
}) {
  const { t } = useTranslation();
  const toolkit =
    state.toolkitDisplayName && state.toolkitSlug && state.toolkitIconUrl
      ? {
          slug: state.toolkitSlug,
          displayName: state.toolkitDisplayName,
          iconUrl: state.toolkitIconUrl,
          fallbackIconUrl: state.toolkitFallbackIconUrl,
        }
      : undefined;
  const permissions = toolkit
    ? getToolkitPermissions(toolkit.slug, toolkit.displayName)
    : [];

  return (
    <div className="rounded-2xl border border-border bg-surface-1 shadow-lg overflow-hidden">
      <div className="px-6 pt-6 pb-4 text-center">
        {toolkit ? (
          <>
            <ConnectionGraphic
              providerIconUrl={toolkit.iconUrl}
              providerFallbackIconUrl={toolkit.fallbackIconUrl}
              providerName={toolkit.displayName}
            />
            <h1 className="text-[18px] font-bold text-text-primary mb-1">
              {t("oauth.connectTitle", { name: toolkit.displayName })}
            </h1>
            <p className="text-[13px] text-text-muted">
              {t("oauth.requestingAccess", { name: toolkit.displayName })}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[18px] font-bold text-text-primary mb-1">
              {t("oauth.connectingAccount")}
            </h1>
            <p className="text-[13px] text-text-muted">
              {t("oauth.waitingForAuth")}
            </p>
          </>
        )}
      </div>

      <div className="px-6 pb-6">
        {/* Permissions list */}
        {toolkit && permissions.length > 0 && (
          <div className="rounded-xl bg-surface-0 border border-border p-4 mb-4">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-3">
              {t("oauth.permissionsRequested")}
            </div>
            <div className="space-y-2.5">
              {permissions.map((perm) => (
                <div key={perm} className="flex items-start gap-2.5">
                  <Shield size={12} className="text-accent shrink-0 mt-0.5" />
                  <span className="text-[12px] text-text-secondary leading-relaxed">
                    {perm}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Spinner */}
        <div className="flex items-center justify-center gap-3 py-4">
          <div className="w-4 h-4 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
          <span className="text-[13px] text-text-muted">
            {t("oauth.waitingAuth")}
          </span>
        </div>

        <p className="text-[11px] text-text-muted text-center leading-relaxed">
          {t("oauth.securityNote")}
        </p>
      </div>
    </div>
  );
}

// ─── Success Card ───────────────────────────────────────────

function SuccessCard({
  state,
}: {
  state: Extract<CallbackState, { phase: "success" }>;
}) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-border bg-surface-1 shadow-lg overflow-hidden">
      <div className="px-6 pt-6 pb-4 text-center">
        <ConnectionGraphicSuccess
          providerIconUrl={state.toolkitIconUrl}
          providerFallbackIconUrl={state.toolkitFallbackIconUrl}
          providerName={state.toolkitName}
        />

        <div className="w-14 h-14 rounded-full bg-[var(--color-success-muted)] flex items-center justify-center mx-auto mb-4">
          <Check size={28} className="text-[var(--color-success)]" />
        </div>

        <h1 className="text-[18px] font-bold text-text-primary mb-1">
          {t("oauth.authSuccess")}
        </h1>
        <p className="text-[13px] text-text-muted mb-6">
          {t("oauth.connectedTo", { name: state.toolkitName })}
        </p>
      </div>

      <div className="px-6 pb-6">
        {/* Return buttons — only show buttons for channels the user has */}
        {state.source === "chat" && (
          <div className="space-y-2.5 mb-4">
            {state.chatChannels.includes("slack") && (
              <button
                type="button"
                onClick={() => {
                  const deeplink = state.slackDeeplink;
                  const nativeUrl = deeplink?.nativeUrl ?? "slack://open";
                  const webUrl = deeplink?.webUrl ?? "https://slack.com/open";

                  // Try native Slack app first; fall back to web after 3s
                  const fallbackTimer = setTimeout(() => {
                    window.open(webUrl, "_blank", "noopener,noreferrer");
                  }, 3000);
                  const cancelFallback = () => {
                    clearTimeout(fallbackTimer);
                    window.removeEventListener("blur", cancelFallback);
                  };
                  window.addEventListener("blur", cancelFallback);
                  window.location.href = nativeUrl;
                }}
                className={cn(
                  "flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl",
                  "bg-[#4A154B] text-white text-[13px] font-medium",
                  "hover:bg-[#3e1240] transition-colors cursor-pointer",
                )}
              >
                <SlackIcon size={16} />
                {t("oauth.returnSlack")}
                <ExternalLink size={12} className="opacity-60" />
              </button>
            )}
            {state.chatChannels.includes("discord") && (
              <a
                href="https://discord.com/channels/@me"
                className={cn(
                  "flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl",
                  "border border-border text-text-secondary text-[13px] font-medium",
                  "hover:bg-surface-2 transition-colors",
                )}
              >
                <DiscordIcon size={16} />
                {t("oauth.returnDiscord")}
                <ExternalLink size={12} className="opacity-60 ml-0.5" />
              </a>
            )}
          </div>
        )}

        {/* Page source — go to integrations */}
        {state.source !== "chat" && (
          <Link
            to="/workspace/integrations"
            className={cn(
              "flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl",
              "bg-accent text-white text-[13px] font-medium",
              "hover:bg-accent-hover transition-colors mb-4",
            )}
          >
            {t("oauth.goToIntegrations")}
          </Link>
        )}

        {/* Footer hint */}
        <p className="text-[11px] text-text-muted text-center leading-relaxed">
          {t("oauth.manageHint")}
        </p>
      </div>
    </div>
  );
}

// ─── Success Connection Graphic (static, no pulse) ──────────

function ConnectionGraphicSuccess({
  providerIconUrl,
  providerFallbackIconUrl,
  providerName,
}: {
  providerIconUrl: string;
  providerFallbackIconUrl?: string;
  providerName: string;
}) {
  return (
    <ConnectionGraphic
      providerIconUrl={providerIconUrl}
      providerFallbackIconUrl={providerFallbackIconUrl}
      providerName={providerName}
    />
  );
}

// ─── Error Card ─────────────────────────────────────────────

function ErrorCard({ message }: { message: string }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-2xl border border-border bg-surface-1 shadow-lg overflow-hidden">
      <div className="px-6 py-6 text-center">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
          <AlertCircle size={24} className="text-red-500" />
        </div>
        <h1 className="text-[18px] font-bold text-text-primary mb-2">
          {t("oauth.connectionFailed")}
        </h1>
        <p className="text-[13px] text-text-muted mb-6">{message}</p>
        <Link
          to="/workspace/integrations"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-[13px] font-medium hover:bg-accent-hover transition-colors"
        >
          <ArrowLeft size={14} />
          {t("oauth.goToIntegrations")}
        </Link>
      </div>
    </div>
  );
}
