import { BrandMark } from "@/components/brand-mark";
import { authClient } from "@/lib/auth-client";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useCallback, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { getApiV1FeishuBindOauthUrl } from "../../lib/api/sdk.gen";

export function FeishuBindPage() {
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
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 mb-5">
            <CheckCircle2 className="h-7 w-7 text-emerald-500" />
          </div>
          <h1 className="text-xl font-bold text-text-primary">
            Feishu account linked!
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Your Feishu identity has been linked to your Nexu account. You can
            now use the bot normally.
          </p>

          <div className="mt-8 flex flex-col gap-3">
            <a
              href={feishuReturnUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover transition-colors"
            >
              Back to Feishu
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <Link
              to="/workspace"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-text-secondary hover:bg-surface-1 transition-colors"
            >
              Explore Nexu
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
            Binding failed
          </h1>
          <p className="mt-2 text-sm text-text-muted">{errorMsg}</p>
          <div className="mt-6 flex flex-col gap-3">
            {ws && bot && (
              <Link
                to={`/feishu/bind?ws=${encodeURIComponent(ws)}&bot=${encodeURIComponent(bot)}`}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg hover:bg-accent-hover transition-colors"
              >
                Try again
              </Link>
            )}
            <a
              href={feishuReturnUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-text-muted hover:text-text-secondary transition-colors"
            >
              Back to Feishu
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
    const returnTo = encodeURIComponent(
      `/feishu/bind?ws=${encodeURIComponent(ws)}&bot=${encodeURIComponent(bot)}`,
    );
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
              Link your
              <br />
              Feishu
              <br />
              identity
            </h2>
            <p className="text-[13px] text-white/45 leading-relaxed mb-6 max-w-[280px]">
              Connect your Feishu account to Nexu to unlock AI-powered workflows
              directly in your chats.
            </p>
          </div>

          <div className="text-[11px] text-white/20">
            &copy; 2026 Nexu by Refly
          </div>
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
                  Link your Feishu account
                </h1>
                <p className="text-[14px] text-text-muted">
                  Sign in to Nexu first, then bind your Feishu identity.
                </p>
              </div>

              <Link
                to={`/auth?mode=signup&source=feishu_bind&returnTo=${returnTo}`}
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg text-[14px] font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-all"
              >
                Create account
              </Link>

              <div className="text-center mt-4">
                <span className="text-[13px] text-text-muted">
                  Already have an account?{" "}
                </span>
                <Link
                  to={`/auth?source=feishu_bind&returnTo=${returnTo}`}
                  className="text-[13px] text-accent font-medium hover:underline underline-offset-2"
                >
                  Log in
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
            <span>&copy; 2026 Nexu by Refly</span>
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
          Link your Feishu account
        </h1>
        <p className="text-sm text-text-muted mb-2">
          Authorize with Feishu to link your identity to your Nexu account.
        </p>
        <p className="text-[13px] text-text-muted mb-6">
          Signed in as{" "}
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
              Redirecting to Feishu...
            </>
          ) : (
            "Bind Feishu Account"
          )}
        </button>

        <div className="text-center mt-4">
          <Link
            to="/auth"
            className="text-[13px] text-text-muted hover:text-text-secondary transition-colors"
          >
            Use a different account
          </Link>
        </div>
      </div>
    </div>
  );
}
