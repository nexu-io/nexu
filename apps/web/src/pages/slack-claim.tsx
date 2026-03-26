import { BrandMark } from "@/components/brand-mark";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/tracking";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import "@/lib/api";
import {
  getApiSharedSlackResolveClaimKey,
  postApiV1SharedSlackClaim,
} from "../../lib/api/sdk.gen";

type ClaimPlatform = "slack" | "feishu";

function detectPlatform(teamId?: string | null): ClaimPlatform {
  if (teamId?.startsWith("feishu:")) return "feishu";
  return "slack";
}

const PLATFORM_CONFIG: Record<
  ClaimPlatform,
  {
    label: string;
    returnUrl: (teamId?: string | null) => string;
  }
> = {
  slack: {
    label: "Slack",
    returnUrl: () => "https://app.slack.com",
  },
  feishu: {
    label: "Feishu",
    returnUrl: (teamId) => {
      const appId = teamId?.replace("feishu:", "");
      return appId
        ? `https://applink.feishu.cn/client/bot/open?appId=${appId}`
        : "https://www.feishu.cn";
    },
  },
};

type ClaimPhase =
  | "resolving"
  | "invalid"
  | "expired"
  | "used"
  | "needs-auth"
  | "confirm"
  | "claiming"
  | "success";

const CLAIM_RETURN_KEY = "nexu_claim_return";

// ── Left panel: product features (new workspace) ──

function NewWorkspacePanel() {
  const { t } = useTranslation();

  const capabilityPills = useMemo(
    () => [
      { emoji: "\u{1F4BB}", label: t("auth.capability.code") },
      { emoji: "\u{1F4CA}", label: t("auth.capability.data") },
      { emoji: "\u270D\uFE0F", label: t("auth.capability.content") },
      { emoji: "\u{1F50D}", label: t("auth.capability.research") },
      { emoji: "\u2699\uFE0F", label: t("auth.capability.automation") },
    ],
    [t],
  );

  return (
    <div className="hidden lg:flex w-[400px] shrink-0 bg-[#111111] flex-col justify-between p-8 relative overflow-hidden">
      <div className="flex items-center gap-2.5">
        <BrandMark className="w-7 h-7 shrink-0" />
        <span className="text-[14px] font-semibold text-white/90">nexu</span>
      </div>

      <div>
        <h2 className="text-[32px] font-bold text-white leading-[1.15] mb-4">
          {t("auth.heroTitle.line1")}
          <br />
          {t("auth.heroTitle.line2")}
          <br />
          {t("auth.heroTitle.line3")}
        </h2>
        <p className="text-[13px] text-white/45 leading-relaxed mb-6 max-w-[280px]">
          {t("auth.heroBody")}
        </p>
        <div className="flex flex-wrap gap-2">
          {capabilityPills.map((p) => (
            <span
              key={p.label}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium bg-white/[0.07] text-white/60 border border-white/[0.06]"
            >
              <span className="text-[11px]">{p.emoji}</span>
              {p.label}
            </span>
          ))}
        </div>
      </div>

      <div className="text-[11px] text-white/20">{t("auth.copyright")}</div>
    </div>
  );
}

// ── Left panel: existing workspace ──

function ExistingWorkspacePanel({
  teamName,
  memberCount,
}: {
  teamName?: string | null;
  memberCount: number;
}) {
  const { t } = useTranslation();

  return (
    <div className="hidden lg:flex w-[400px] shrink-0 bg-[#111111] flex-col justify-between p-8 relative overflow-hidden">
      <div className="flex items-center gap-2.5">
        <BrandMark className="w-7 h-7 shrink-0" />
        <span className="text-[14px] font-semibold text-white/90">nexu</span>
      </div>

      <div>
        <h2 className="text-[32px] font-bold text-white leading-[1.15] mb-4">
          {t("claim.teamUsesNexu.line1")}
          <br />
          {t("claim.teamUsesNexu.line2")}
          <br />
          {t("claim.teamUsesNexu.line3")}
        </h2>
        {teamName && (
          <p className="text-[15px] text-white/70 font-medium mb-3">
            {teamName}
          </p>
        )}
        <div className="flex items-center gap-2.5 mb-6">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-[color-mix(in_srgb,var(--color-success)_20%,transparent)] text-[var(--color-success)]">
            <Users className="w-4 h-4" />
          </div>
          <span className="text-[13px] text-white/50">
            {t("claim.teammatesHere", {
              count: memberCount,
              s: memberCount !== 1 ? "s" : "",
            })}
          </span>
        </div>
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-success)_20%,transparent)] bg-[var(--color-success-subtle)] p-4">
          <p className="text-[13px] text-[color-mix(in_srgb,var(--color-success)_80%,transparent)] leading-relaxed">
            {t("claim.noConfigNeeded")}
          </p>
        </div>
      </div>

      <div className="text-[11px] text-white/20">{t("auth.copyright")}</div>
    </div>
  );
}

// ── Main component ──

export function SlackClaimPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { data: session, isPending: authPending } = authClient.useSession();
  const claimSubmittedRef = useRef(false);
  const [userConfirmed, setUserConfirmed] = useState(false);

  const claimKey = useMemo(
    () => searchParams.get("token") ?? "",
    [searchParams],
  );

  // Check if user just came back from auth page (returnTo flow)
  const isReturnFromAuth = useMemo(() => {
    const val = sessionStorage.getItem(CLAIM_RETURN_KEY);
    if (val === claimKey) {
      sessionStorage.removeItem(CLAIM_RETURN_KEY);
      return true;
    }
    return false;
  }, [claimKey]);

  // Resolve claim key
  const resolveQuery = useQuery({
    queryKey: ["resolve-claim-key", claimKey],
    queryFn: async () => {
      const { data, error } = await getApiSharedSlackResolveClaimKey({
        query: { token: claimKey },
      });
      if (error) {
        throw new Error("Failed to validate claim link");
      }
      return data;
    },
    enabled: claimKey.length > 0,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  const resolved = resolveQuery.data;
  const platform = detectPlatform(resolved?.teamId);
  const platformCfg = PLATFORM_CONFIG[platform];

  // Claim mutation
  const claimMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await postApiV1SharedSlackClaim({
        body: { token: claimKey },
      });
      if (error) {
        const message =
          typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
            ? error.message
            : "Claim failed";
        throw new Error(message);
      }
      return data;
    },
    onSuccess: () => {
      track("claim_completed", { source: "IM" });
      toast.success("Slack account claimed successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Auto-submit claim only when returning from auth page (not on direct visit)
  useEffect(() => {
    if (
      !session?.user ||
      !resolved?.valid ||
      claimSubmittedRef.current ||
      claimMutation.isSuccess ||
      (!isReturnFromAuth && !userConfirmed)
    ) {
      return;
    }
    claimSubmittedRef.current = true;
    claimMutation.mutate();
  }, [
    session?.user,
    resolved?.valid,
    claimMutation.isSuccess,
    claimMutation.mutate,
    isReturnFromAuth,
    userConfirmed,
  ]);

  const handleConfirmClaim = useCallback(() => {
    setUserConfirmed(true);
  }, []);

  // Track page view
  useEffect(() => {
    if (resolved?.valid) {
      track("claim_page_viewed", {
        source: "IM",
        is_existing_workspace: resolved.isExistingWorkspace ?? false,
      });
    }
  }, [resolved?.valid, resolved?.isExistingWorkspace]);

  // Determine phase
  let phase: ClaimPhase = "resolving";
  if (!claimKey) {
    phase = "invalid";
  } else if (resolveQuery.isError) {
    phase = "invalid";
  } else if (resolved) {
    if (resolved.expired) {
      phase = "expired";
    } else if (resolved.used) {
      phase = "used";
    } else if (!resolved.valid) {
      phase = "invalid";
    } else if (claimMutation.isSuccess) {
      phase = "success";
    } else if (session?.user && (isReturnFromAuth || userConfirmed)) {
      phase = "claiming";
    } else if (session?.user) {
      phase = "confirm";
    } else if (!authPending) {
      phase = "needs-auth";
    }
  }

  // ── Resolving ──
  if (phase === "resolving") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  // ── Error states ──
  if (phase === "invalid" || phase === "expired" || phase === "used") {
    const content = {
      invalid: {
        title: t("claim.invalidLink"),
        desc: t("claim.invalidLinkDesc", { platform: platformCfg.label }),
      },
      expired: {
        title: t("claim.linkExpired"),
        desc: t("claim.linkExpiredDesc", { platform: platformCfg.label }),
      },
      used: {
        title: t("claim.linkUsed"),
        desc: t("claim.linkUsedDesc"),
      },
    }[phase];

    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-4" />
          <h1 className="text-lg font-semibold text-text-primary">
            {content.title}
          </h1>
          <p className="mt-2 text-sm text-text-muted">{content.desc}</p>
          <div className="mt-6 flex flex-col gap-3">
            <a
              href={platformCfg.returnUrl(resolved?.teamId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover transition-colors"
            >
              {t("claim.open", { platform: platformCfg.label })}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Link
              to="/"
              className="text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              {t("claim.goToSignIn")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Needs auth (not logged in) ──
  if (phase === "needs-auth") {
    const isExisting = resolved?.isExistingWorkspace ?? false;

    return (
      <div className="flex min-h-screen">
        {isExisting ? (
          <ExistingWorkspacePanel
            teamName={resolved?.teamName}
            memberCount={resolved?.memberCount ?? 0}
          />
        ) : (
          <NewWorkspacePanel />
        )}

        {/* Right panel */}
        <div className="flex-1 flex flex-col bg-surface-0">
          {/* Mobile branding */}
          <nav className="border-b border-border lg:hidden">
            <div className="flex items-center px-4 sm:px-6 h-14">
              <Link to="/" className="flex items-center gap-2.5">
                <BrandMark className="w-7 h-7 shrink-0" />
                <span className="text-sm font-semibold tracking-tight text-text-primary">
                  Nexu
                </span>
              </Link>
            </div>
          </nav>

          <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
            <div className="w-full max-w-[360px]">
              <div className="mb-8">
                <h1 className="text-[22px] font-bold text-text-primary mb-1.5">
                  {isExisting ? t("claim.joinTeam") : t("claim.getStarted")}
                </h1>
                <p className="text-[14px] text-text-muted">
                  {isExisting
                    ? t("claim.joinTeamDesc", { platform: platformCfg.label })
                    : t("claim.createAccountDesc", {
                        platform: platformCfg.label,
                      })}
                </p>
              </div>

              {isExisting && (
                <div className="mb-6 rounded-lg border border-[color-mix(in_srgb,var(--color-success)_20%,transparent)] bg-[var(--color-success-subtle)] p-3 lg:hidden">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-[var(--color-success)] shrink-0" />
                    <span className="text-[12px] text-[var(--color-success)]">
                      {t("claim.teammatesAlready", {
                        count: resolved?.memberCount ?? 0,
                      })}
                    </span>
                  </div>
                </div>
              )}

              <Link
                to="/"
                onClick={() =>
                  sessionStorage.setItem(CLAIM_RETURN_KEY, claimKey)
                }
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg text-[14px] font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-all"
              >
                {t("claim.createAccount")}
              </Link>

              <div className="text-center mt-4">
                <span className="text-[13px] text-text-muted">
                  {t("claim.alreadyHaveAccount")}{" "}
                </span>
                <Link
                  to="/"
                  onClick={() =>
                    sessionStorage.setItem(CLAIM_RETURN_KEY, claimKey)
                  }
                  className="text-[13px] text-accent font-medium hover:underline underline-offset-2"
                >
                  {t("auth.logIn")}
                </Link>
              </div>
            </div>
          </div>

          <div
            className="flex items-center justify-center gap-3 px-4 sm:px-6 pt-3 pb-4 text-[11px] text-text-muted"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <a
              href="https://nexu.io/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors"
            >
              {t("auth.terms")}
            </a>
            <span className="text-border">&middot;</span>
            <a
              href="https://nexu.io/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors"
            >
              {t("auth.privacy")}
            </a>
            <span className="text-border">&middot;</span>
            <span>{t("auth.copyright")}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Confirm (logged-in user visiting directly, needs explicit action) ──
  if (phase === "confirm") {
    const isExisting = resolved?.isExistingWorkspace ?? false;

    return (
      <div className="flex min-h-screen">
        {isExisting ? (
          <ExistingWorkspacePanel
            teamName={resolved?.teamName}
            memberCount={resolved?.memberCount ?? 0}
          />
        ) : (
          <NewWorkspacePanel />
        )}

        <div className="flex-1 flex flex-col bg-surface-0">
          <nav className="border-b border-border lg:hidden">
            <div className="flex items-center px-4 sm:px-6 h-14">
              <Link to="/" className="flex items-center gap-2.5">
                <BrandMark className="w-7 h-7 shrink-0" />
                <span className="text-sm font-semibold tracking-tight text-text-primary">
                  Nexu
                </span>
              </Link>
            </div>
          </nav>

          <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
            <div className="w-full max-w-[360px] text-center">
              <h1 className="text-[22px] font-bold text-text-primary mb-1.5">
                {isExisting
                  ? t("claim.joinTeam")
                  : t("claim.claimAccess", { platform: platformCfg.label })}
              </h1>
              <p className="text-[14px] text-text-muted mb-6">
                {isExisting
                  ? t("claim.claimAccessDescExisting", {
                      platform: platformCfg.label,
                      team: resolved?.teamName ?? "your team",
                    })
                  : t("claim.claimAccessDescNew", {
                      platform: platformCfg.label,
                    })}
              </p>

              <p className="text-[13px] text-text-muted mb-6">
                {t("claim.signedInAs")}{" "}
                <strong className="text-text-secondary">
                  {session?.user?.email ?? session?.user?.name}
                </strong>
              </p>

              <button
                type="button"
                onClick={handleConfirmClaim}
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg text-[14px] font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-all"
              >
                {t("claim.claimButton", { platform: platformCfg.label })}
              </button>

              <div className="text-center mt-4">
                <Link
                  to="/"
                  className="text-[13px] text-text-muted hover:text-text-secondary transition-colors"
                >
                  {t("claim.useDifferentAccount")}
                </Link>
              </div>
            </div>
          </div>

          <div
            className="flex items-center justify-center gap-3 px-4 sm:px-6 pt-3 pb-4 text-[11px] text-text-muted"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <a
              href="https://nexu.io/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors"
            >
              {t("auth.terms")}
            </a>
            <span className="text-border">&middot;</span>
            <a
              href="https://nexu.io/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors"
            >
              {t("auth.privacy")}
            </a>
            <span className="text-border">&middot;</span>
            <span>{t("auth.copyright")}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Claiming (auto-submit in progress) ──
  if (phase === "claiming") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-8 text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-text-muted" />
          <h1 className="mt-4 text-lg font-semibold text-text-primary">
            {t("claim.claiming", { platform: platformCfg.label })}
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {t("claim.claimingDesc", { platform: platformCfg.label })}
          </p>
        </div>
      </div>
    );
  }

  // ── Success ──
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-success-muted)] mb-5">
          <CheckCircle2 className="h-7 w-7 text-[var(--color-success)]" />
        </div>
        <h1 className="text-xl font-bold text-text-primary">
          {t("claim.allSet")}
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          {t("claim.allSetDesc", { platform: platformCfg.label })}
          {resolved?.teamName && (
            <>
              {" "}
              {t("claim.nowPartOf")} <strong>{resolved.teamName}</strong>.
            </>
          )}
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <a
            href={platformCfg.returnUrl(resolved?.teamId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              track("claim_back_to_platform_clicked", {
                source: "IM",
                platform,
              })
            }
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover transition-colors"
          >
            {t("claim.backTo", { platform: platformCfg.label })}
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <Link
            to="/workspace"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-1 transition-colors"
          >
            {t("claim.exploreNexu")}
          </Link>
        </div>
      </div>
    </div>
  );
}
