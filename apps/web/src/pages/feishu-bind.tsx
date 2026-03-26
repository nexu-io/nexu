import { BrandMark } from "@/components/brand-mark";
import { authClient } from "@/lib/auth-client";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { getApiV1FeishuBindOauthUrl } from "../../lib/api/sdk.gen";

export function FeishuBindPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { data: session, isPending: authPending } = authClient.useSession();

  const success = searchParams.get("success") === "true";
  const errorMsg = searchParams.get("error");
  const ws = searchParams.get("ws") ?? "";
  const bot = searchParams.get("bot") ?? "";

  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const appId = ws.startsWith("feishu:") ? ws.slice("feishu:".length) : "";
  const feishuReturnUrl = appId
    ? `https://applink.feishu.cn/client/bot/open?appId=${appId}`
    : "https://www.feishu.cn";

  const handleBind = useCallback(async () => {
    if (!ws || !bot) {
      setLocalError("Missing workspace or bot information");
      return;
    }
    setLoading(true);
    setLocalError(null);
    try {
      const { data, error } = await getApiV1FeishuBindOauthUrl({
        query: { workspaceKey: ws, botId: bot },
      });
      if (error || !data?.url) {
        const msg =
          typeof error === "object" && error !== null && "message" in error
            ? (error as { message: string }).message
            : "Failed to get OAuth URL";
        setLocalError(msg);
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setLocalError("Network error");
      setLoading(false);
    }
  }, [ws, bot]);

  // ── Success ──
  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-success-muted)] mb-5">
            <CheckCircle2 className="h-7 w-7 text-[var(--color-success)]" />
          </div>
          <h1 className="text-xl font-bold text-text-primary">
            {t("feishuBind.linked")}
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            {t("feishuBind.linkedDesc")}
          </p>

          <div className="mt-8 flex flex-col gap-3">
            <a
              href={feishuReturnUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover transition-colors"
            >
              {t("feishuBind.backToFeishu")}
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Link
              to="/workspace"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-1 transition-colors"
            >
              {t("feishuBind.exploreNexu")}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ── Error from OAuth callback ──
  if (errorMsg) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-8 text-center">
          <AlertTriangle className="mx-auto h-8 w-8 text-amber-500 mb-4" />
          <h1 className="text-lg font-semibold text-text-primary">
            {t("feishuBind.bindFailed")}
          </h1>
          <p className="mt-2 text-sm text-text-muted">{errorMsg}</p>
          <div className="mt-6 flex flex-col gap-3">
            {ws && bot && (
              <Link
                to={`/feishu/bind?ws=${encodeURIComponent(ws)}&bot=${encodeURIComponent(bot)}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover transition-colors"
              >
                {t("feishuBind.tryAgain")}
              </Link>
            )}
            <a
              href={feishuReturnUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              {t("feishuBind.backToFeishu")}
            </a>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading auth state ──
  if (authPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  // ── Not logged in ──
  if (!session?.user) {
    return (
      <div className="flex min-h-screen">
        {/* Left panel */}
        <div className="hidden lg:flex w-[400px] shrink-0 bg-[#111111] flex-col justify-between p-8 relative overflow-hidden">
          <div className="flex items-center gap-2.5">
            <BrandMark className="w-7 h-7 shrink-0" />
            <span className="text-[14px] font-semibold text-white/90">
              Nexu
            </span>
          </div>

          <div>
            <h2 className="text-[32px] font-bold text-white leading-[1.15] mb-4">
              {t("feishuBind.linkTitle.line1")}
              <br />
              {t("feishuBind.linkTitle.line2")}
              <br />
              {t("feishuBind.linkTitle.line3")}
            </h2>
            <p className="text-[13px] text-white/45 leading-relaxed mb-6 max-w-[280px]">
              {t("feishuBind.linkDesc")}
            </p>
          </div>

          <div className="text-[11px] text-white/20">{t("auth.copyright")}</div>
        </div>

        {/* Right panel */}
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
            <div className="w-full max-w-[360px]">
              <div className="mb-8">
                <h1 className="text-[22px] font-bold text-text-primary mb-1.5">
                  {t("feishuBind.linkAccount")}
                </h1>
                <p className="text-[14px] text-text-muted">
                  {t("feishuBind.signInFirst")}
                </p>
              </div>

              <Link
                to="/"
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
                  className="text-[13px] text-accent font-medium hover:underline underline-offset-2"
                >
                  {t("auth.logIn")}
                </Link>
              </div>
            </div>
          </div>

          <div
            className="flex items-center justify-center gap-3 px-4 sm:px-6 pt-3 pb-4 text-[11px] text-text-muted"
            style={{
              paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
            }}
          >
            <span>{t("auth.copyright")}</span>
          </div>
        </div>
      </div>
    );
  }

  // ── Logged in — show bind button ──
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface-1 p-8 text-center">
        <h1 className="text-xl font-bold text-text-primary mb-2">
          {t("feishuBind.linkAccount")}
        </h1>
        <p className="text-sm text-text-muted mb-2">
          {t("feishuBind.authorizeDesc")}
        </p>
        <p className="text-[13px] text-text-muted mb-6">
          {t("feishuBind.signedInAs")}{" "}
          <strong className="text-text-secondary">
            {session.user.email ?? session.user.name}
          </strong>
        </p>

        {localError && (
          <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <p className="text-[13px] text-red-500">{localError}</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleBind}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg text-[14px] font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-all disabled:opacity-50"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("feishuBind.redirecting")}
            </>
          ) : (
            t("feishuBind.bindButton")
          )}
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
  );
}
