import {
  syncDesktopCloudQueries,
  useDesktopCloudStatus,
} from "@/hooks/use-desktop-cloud-status";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  Eye,
  EyeOff,
  Infinity as InfinityIcon,
  Key,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  getApiInternalDesktopCloudStatus,
  postApiInternalDesktopCloudConnect,
  postApiInternalDesktopCloudDisconnect,
} from "../../lib/api/sdk.gen";
import { BrandRail } from "../components/brand-rail";
import { LanguageSwitcher } from "../components/language-switcher";
import { ProviderLogo } from "../components/provider-logo";
import { useLocale } from "../hooks/use-locale";
import { usePageTitle } from "../hooks/use-page-title";
import { authClient } from "../lib/auth-client";
import { openExternalUrl } from "../lib/desktop-links";
import { track } from "../lib/tracking";

const SETUP_COMPLETE_KEY = "nexu_setup_complete";

function isSetupComplete(): boolean {
  return localStorage.getItem(SETUP_COMPLETE_KEY) === "1";
}

export function markSetupComplete(): void {
  localStorage.setItem(SETUP_COMPLETE_KEY, "1");
}

function FadeIn({
  children,
  delay = 0,
  className = "",
}: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <div
      className={`animate-fade-in-up ${className}`}
      style={{ animationDelay: `${delay}ms`, animationFillMode: "both" }}
    >
      {children}
    </div>
  );
}

const PROVIDER_OPTIONS = [
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-..." },
  { id: "openai", name: "OpenAI", placeholder: "sk-..." },
  { id: "google", name: "Google AI", placeholder: "AIza..." },
  { id: "siliconflow", name: "SiliconFlow", placeholder: "sk-..." },
  { id: "ppio", name: "PPIO", placeholder: "sk-..." },
  { id: "openrouter", name: "OpenRouter", placeholder: "sk-or-..." },
  { id: "minimax", name: "MiniMax", placeholder: "sk-..." },
  { id: "kimi", name: "Kimi", placeholder: "sk-..." },
  { id: "glm", name: "GLM", placeholder: "eyJ..." },
] as const;

type Mode = "choose" | "byok";

export function WelcomePage() {
  const { t } = useLocale();
  usePageTitle(t("welcome.pageTitle"));
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: session, isPending: authPending } = authClient.useSession();
  const setupComplete = isSetupComplete();

  const [mode, setMode] = useState<Mode>("choose");

  const [selectedProvider, setSelectedProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [cloudConnecting, setCloudConnecting] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const { data: cloudStatus, refetch: refetchDesktopCloudStatus } =
    useDesktopCloudStatus();
  const cloudConnected = cloudStatus?.connected ?? false;
  const cloudPolling = cloudStatus?.polling ?? false;

  if (setupComplete && authPending) {
    return <div className="min-h-screen bg-[#0b0b0d]" />;
  }

  if (setupComplete && session?.user) {
    return <Navigate to="/workspace" replace />;
  }

  useEffect(() => {
    if (!cloudConnected) {
      return;
    }

    markSetupComplete();
    navigate("/workspace", { replace: true });
  }, [cloudConnected, navigate]);

  // Poll cloud-status while waiting for browser login
  useEffect(() => {
    if (!cloudConnecting && !cloudPolling) return;
    const interval = setInterval(async () => {
      try {
        const result = await refetchDesktopCloudStatus();
        if (result.data?.connected) {
          setCloudConnecting(false);
          setLoginError(null);
          await syncDesktopCloudQueries(queryClient);
          markSetupComplete();
          navigate("/workspace");
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [
    cloudConnecting,
    cloudPolling,
    navigate,
    queryClient,
    refetchDesktopCloudStatus,
  ]);

  const activePreset =
    PROVIDER_OPTIONS.find((p) => p.id === selectedProvider) ??
    PROVIDER_OPTIONS[0];
  const loginOption = {
    title: t("welcome.option.login.title"),
    badge: t("welcome.option.login.badge"),
    description: t("welcome.option.login.description"),
    highlights: [
      "Claude Sonnet 4.5",
      "GPT-4o",
      t("welcome.option.login.highlight.unlimited"),
    ],
    meta: [
      t("welcome.option.login.meta.1"),
      t("welcome.option.login.meta.2"),
      t("welcome.option.login.meta.3"),
    ],
    icon: Zap,
  };

  const handleAccountLogin = async () => {
    track("welcome_option_click", { option: "nexu_account" });
    setCloudConnecting(true);
    setLoginError(null);
    try {
      let { data } = await postApiInternalDesktopCloudConnect({
        body: { source: "welcome_page" },
      });
      // If a stale polling session exists, disconnect and retry once. But if
      // the desktop runtime is already polling, keep the current waiting state
      // instead of resetting the browser auth flow.
      if (data?.error === "Connection attempt already in progress") {
        const statusResponse = await getApiInternalDesktopCloudStatus();
        const status = statusResponse.data;
        await refetchDesktopCloudStatus();

        if (status?.connected) {
          setCloudConnecting(false);
          markSetupComplete();
          navigate("/workspace", { replace: true });
          return;
        }

        if (status?.polling) {
          return;
        }

        setCloudConnecting(false);
        setLoginError(null);
        return;
      }
      if (data?.error === "Already connected. Disconnect first.") {
        setLoginError(null);
        await syncDesktopCloudQueries(queryClient);
        markSetupComplete();
        navigate("/workspace", { replace: true });
        return;
      }
      if (data?.error) {
        await postApiInternalDesktopCloudDisconnect().catch(() => {});
        ({ data } = await postApiInternalDesktopCloudConnect({
          body: { source: "welcome_page" },
        }));
      }
      if (data?.error) {
        setLoginError(data.error ?? t("welcome.connectFailed"));
        setCloudConnecting(false);
        toast.error(data.error ?? t("welcome.connectFailed"));
        return;
      }
      if (data?.browserUrl) {
        await openExternalUrl(data.browserUrl);
        toast.info(t("welcome.browserOpened"));
      }
      if (!data?.browserUrl) {
        const statusResponse = await getApiInternalDesktopCloudStatus().catch(
          () => null,
        );
        const status = statusResponse?.data;
        const connected = Boolean(status?.connected);
        const polling = Boolean(status?.polling);

        await refetchDesktopCloudStatus();

        if (connected) {
          setCloudConnecting(false);
          markSetupComplete();
          navigate("/workspace", { replace: true });
          return;
        }

        if (!polling) {
          setCloudConnecting(false);
        }
      }
      // Keep cloudConnecting=true — polling effect will detect completion.
    } catch (_error) {
      setLoginError(t("welcome.cloudConnectError"));
      setCloudConnecting(false);
      toast.error(t("welcome.cloudConnectError"));
    }
  };

  const handleCancelLogin = async () => {
    try {
      await postApiInternalDesktopCloudDisconnect();
    } catch {
      /* ignore */
    }
    setCloudConnecting(false);
    setLoginError(null);
    toast.info(t("welcome.connectCancelled"));
  };

  const handleVerifyKey = () => {
    if (!apiKey.trim()) return;
    setVerifying(true);
    setTimeout(() => {
      setVerifying(false);
      setVerified(true);
    }, 1200);
  };

  const handleByokContinue = () => {
    markSetupComplete();
    navigate("/workspace");
  };

  const handleByokEntry = () => {
    track("welcome_option_click", { option: "byok" });
    markSetupComplete();
    navigate("/workspace/models?setup=1&tab=providers");
  };

  return (
    <div className="min-h-screen bg-[#0b0b0d] text-white relative">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <BrandRail
          onLogoClick={() => navigate("/")}
          topRight={<LanguageSwitcher variant="light" size="md" />}
        />

        <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#f7f5ef] px-5 py-8 text-text-primary sm:px-8 lg:px-10">
          <div className="absolute inset-0 bg-[radial-gradient(80%_80%_at_20%_15%,rgba(0,0,0,0.035),transparent_45%),radial-gradient(70%_70%_at_85%_85%,rgba(0,0,0,0.04),transparent_42%)]" />

          <div className="relative z-10 w-full max-w-[620px]">
            <nav className="mb-8 flex items-center justify-between lg:hidden">
              <button
                type="button"
                onClick={() => navigate("/")}
                className="flex items-center cursor-pointer text-accent"
              >
                <img
                  src="/brand/logo-black-1.svg"
                  alt="nexu"
                  className="h-5 w-auto object-contain"
                />
              </button>
              <div className="flex items-center gap-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-text-muted">
                  {t("welcome.mobileLabel")}
                </div>
                <LanguageSwitcher variant="dark" />
              </div>
            </nav>

            {mode === "choose" && (
              <FadeIn delay={120}>
                <div className="rounded-[32px] border border-black/10 bg-white/88 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] backdrop-blur-sm sm:p-7">
                  <div className="border-b border-black/8 pb-6">
                    <h2
                      className="text-[34px] leading-[0.98] tracking-tight text-[#181816] sm:text-[42px]"
                      style={{ fontFamily: "Georgia, Times New Roman, serif" }}
                    >
                      {t("welcome.title")}
                    </h2>
                    <p className="mt-3 max-w-[480px] text-[14px] leading-[1.8] text-text-secondary">
                      {t("welcome.subtitle")}
                    </p>
                  </div>

                  <div className="mt-5 space-y-3">
                    <FadeIn delay={180}>
                      {cloudConnecting ? (
                        <div className="relative w-full rounded-[28px] border border-black/12 bg-[linear-gradient(135deg,#7c2d12_0%,#c2410c_100%)] p-5 text-white">
                          <div className="flex flex-col items-center gap-4 py-4">
                            <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
                            <div className="text-center">
                              <div className="text-[15px] font-semibold">
                                {t("welcome.waitingLogin")}
                              </div>
                              <p className="mt-2 text-[12px] text-white/50">
                                {t("welcome.waitingLoginHint")}
                              </p>
                            </div>
                            {loginError && (
                              <p className="text-[12px] text-red-400">
                                {loginError}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => void handleCancelLogin()}
                              className="mt-1 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-[12px] text-white/70 transition-colors hover:bg-white/[0.12] hover:text-white cursor-pointer"
                            >
                              {t("welcome.cancel")}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            void handleAccountLogin();
                          }}
                          disabled={cloudConnecting}
                          className={`group w-full rounded-[28px] border p-5 text-left transition-all duration-300 ${
                            cloudConnecting
                              ? "opacity-40 cursor-not-allowed"
                              : "cursor-pointer hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(0,0,0,0.16)]"
                          } ${"border-black/12 bg-[linear-gradient(135deg,#18181b_0%,#232327_100%)] text-white"}`}
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="flex h-11 w-11 items-center justify-center rounded-2xl shrink-0 bg-white/[0.08] text-white">
                                <loginOption.icon size={18} />
                              </div>
                              <div
                                className="text-[22px] leading-none tracking-tight text-white"
                                style={{
                                  fontFamily: "Georgia, Times New Roman, serif",
                                }}
                              >
                                {loginOption.title}
                              </div>
                            </div>
                            <span className="rounded-full bg-white/[0.08] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75 shrink-0">
                              {loginOption.badge}
                            </span>
                          </div>

                          <div className="mt-4 flex items-start justify-between gap-4">
                            <div>
                              <p className="mt-3 max-w-[430px] text-[13px] leading-[1.75] text-white/64">
                                {loginOption.description}
                              </p>
                            </div>
                            <ArrowRight
                              size={16}
                              className="mt-4 shrink-0 text-white/55"
                            />
                          </div>

                          <div className="mt-4 flex flex-wrap gap-2">
                            {loginOption.highlights.map((tag) => (
                              <span
                                key={tag}
                                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/78"
                              >
                                {tag ===
                                  t(
                                    "welcome.option.login.highlight.unlimited",
                                  ) && <InfinityIcon size={11} />}
                                {tag}
                              </span>
                            ))}
                          </div>

                          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/44">
                            {loginOption.meta.map((item) => (
                              <span key={item}>{item}</span>
                            ))}
                          </div>
                        </button>
                      )}
                    </FadeIn>

                    <FadeIn delay={250}>
                      <button
                        type="button"
                        onClick={handleByokEntry}
                        className="flex w-full items-center justify-between rounded-[22px] border border-black/10 bg-[#f5f2ea] px-4 py-3 text-left text-[13px] text-text-secondary transition-all hover:-translate-y-0.5 hover:border-black/16 hover:text-text-primary hover:shadow-[0_10px_22px_rgba(0,0,0,0.05)] cursor-pointer"
                      >
                        <span>{t("welcome.byokLink")}</span>
                        <ArrowRight size={15} className="text-text-muted" />
                      </button>
                    </FadeIn>

                    <FadeIn delay={320}>
                      <div className="rounded-[22px] border border-black/8 bg-[#f5f1e7] px-4 py-3 text-[12px] leading-[1.75] text-text-secondary">
                        {t("welcome.rewardsHint")}
                      </div>
                    </FadeIn>
                  </div>

                  <FadeIn delay={380}>
                    <div className="mt-5 flex items-center justify-center gap-4 border-t border-black/8 pt-5 text-[12px] text-text-muted">
                      <a
                        href="https://nexu.io/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cursor-pointer transition-colors hover:text-text-secondary"
                      >
                        {t("auth.terms")}
                      </a>
                      <span className="select-none text-border-hover">·</span>
                      <a
                        href="https://nexu.io/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="cursor-pointer transition-colors hover:text-text-secondary"
                      >
                        {t("auth.privacy")}
                      </a>
                    </div>
                  </FadeIn>
                </div>
              </FadeIn>
            )}

            {mode === "byok" && (
              <FadeIn delay={100}>
                <div className="rounded-[32px] border border-black/10 bg-white/92 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.08)] sm:p-7">
                  <button
                    type="button"
                    onClick={() => setMode("choose")}
                    className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-text-muted transition-colors hover:text-text-secondary cursor-pointer"
                  >
                    <ChevronLeft size={14} />
                    {t("welcome.back")}
                  </button>

                  <div className="border-b border-black/8 pb-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-[#f2eee4] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
                      <Key size={11} />
                      BYOK
                    </div>
                    <h2
                      className="mt-4 text-[32px] leading-[0.98] tracking-tight text-[#181816]"
                      style={{ fontFamily: "Georgia, Times New Roman, serif" }}
                    >
                      {t("welcome.byok.title")}
                    </h2>
                    <p className="mt-3 text-[14px] leading-[1.75] text-text-secondary">
                      {t("welcome.byok.subtitle")}
                    </p>
                  </div>

                  <div className="mt-6 grid grid-cols-2 gap-2">
                    {PROVIDER_OPTIONS.map((p) => (
                      <button
                        type="button"
                        key={p.id}
                        onClick={() => {
                          setSelectedProvider(p.id);
                          setApiKey("");
                          setVerified(false);
                        }}
                        className={`flex items-center gap-2 rounded-2xl px-3 py-3 text-[12px] font-medium transition-all cursor-pointer ${
                          selectedProvider === p.id
                            ? "border border-black/14 bg-[#18181b] text-white shadow-[0_8px_20px_rgba(0,0,0,0.08)]"
                            : "border border-border bg-surface-0 text-text-secondary hover:border-border-hover hover:text-text-primary"
                        }`}
                      >
                        <ProviderLogo provider={p.id} size={16} />
                        {p.name}
                      </button>
                    ))}
                  </div>

                  <div className="mt-4 space-y-3">
                    <div className="relative">
                      <input
                        type={showKey ? "text" : "password"}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setVerified(false);
                        }}
                        placeholder={activePreset.placeholder}
                        className="w-full rounded-2xl border border-border bg-surface-0 px-4 py-3 pr-12 font-mono text-[13px] text-text-primary placeholder:text-text-muted/50 focus:border-accent/30 focus:outline-none focus:ring-2 focus:ring-accent/10 transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
                      >
                        {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 rounded-2xl border border-black/8 bg-[#f6f3ec] px-4 py-3 text-[12px] leading-[1.7] text-text-secondary">
                    {t("welcome.byok.note")}
                  </div>

                  <div className="mt-5">
                    {!verified ? (
                      <button
                        type="button"
                        onClick={handleVerifyKey}
                        disabled={!apiKey.trim() || verifying}
                        className="flex h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-accent text-[14px] font-semibold text-accent-fg transition-all hover:bg-accent/90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                      >
                        {verifying ? (
                          <>
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current/30 border-t-current" />
                            {t("welcome.byok.verify.loading")}
                          </>
                        ) : (
                          t("welcome.byok.verify.idle")
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleByokContinue}
                        className="flex h-[48px] w-full items-center justify-center gap-2 rounded-2xl bg-[var(--color-success)] text-[14px] font-semibold text-white transition-all hover:brightness-[0.92] active:scale-[0.98] cursor-pointer"
                      >
                        <Check size={16} />
                        {t("welcome.byok.success")}
                        <ArrowRight size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </FadeIn>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
