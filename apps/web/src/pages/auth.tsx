import { authClient } from "@/lib/auth-client";
import { identify, setUserId, track } from "@/lib/tracking";
import "@/lib/api";
import { BrandMark } from "@/components/brand-mark";
import { BrandRail } from "@/components/brand-rail";
import { ArrowRight, Loader2, Mail } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  postApiAuthCheckEmail,
  postApiV1AuthDesktopAuthorize,
  postApiV1MeAuthSource,
} from "../../lib/api/sdk.gen";

const OTP_LENGTH = 6;
const OTP_SLOTS = Array.from({ length: OTP_LENGTH }, (_, i) => ({
  key: `otp-${i}`,
  i,
}));
const RESEND_COOLDOWN = 30;

function OtpInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
}) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, char: string) => {
    if (!/^\d?$/.test(char)) return;
    const next = value.split("");
    next[index] = char;
    const joined = next.join("");
    onChange(joined);
    if (char && index < OTP_LENGTH - 1) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === "Backspace" && !value[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, OTP_LENGTH);
    if (pasted) {
      onChange(pasted.padEnd(OTP_LENGTH, " ").slice(0, OTP_LENGTH));
      inputRefs.current[Math.min(pasted.length, OTP_LENGTH - 1)]?.focus();
    }
  };

  return (
    <div className="flex gap-2 justify-center">
      {OTP_SLOTS.map((slot) => (
        <input
          key={slot.key}
          ref={(el) => {
            inputRefs.current[slot.i] = el;
          }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[slot.i] && value[slot.i] !== " " ? value[slot.i] : ""}
          onChange={(e) => handleChange(slot.i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(slot.i, e)}
          onPaste={slot.i === 0 ? handlePaste : undefined}
          disabled={disabled}
          className="w-11 h-12 text-center text-lg font-semibold rounded-lg border border-border bg-surface-1 text-text-primary focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-all disabled:opacity-60"
        />
      ))}
    </div>
  );
}

export function AuthPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const isLogin = searchParams.get("mode") !== "signup";
  const isDesktopAuth = searchParams.get("desktop") === "1";
  const deviceId = searchParams.get("device_id");
  const returnToParam = searchParams.get("returnTo");
  const returnTo =
    returnToParam?.startsWith("/") && !returnToParam.startsWith("//")
      ? returnToParam
      : "/workspace";
  const authSourceParam = searchParams.get("source");
  const [loading, setLoading] = useState<string | null>(null);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [desktopConnected, setDesktopConnected] = useState(false);
  const [desktopAuthorizing, setDesktopAuthorizing] = useState(false);
  const [closeCountdown, setCloseCountdown] = useState(5);
  const desktopAuthCalled = useRef(false);

  /** After login, authorize the desktop device and show success screen. */
  const handleDesktopAuthorize = useCallback(async () => {
    if (!deviceId || desktopAuthCalled.current) return;
    desktopAuthCalled.current = true;
    setDesktopAuthorizing(true);
    try {
      const { error } = await postApiV1AuthDesktopAuthorize({
        body: { deviceId },
      });
      if (error) {
        toast.error(
          (error as { error?: string }).error ?? "Failed to connect desktop",
        );
        // Don't reset desktopAuthCalled — prevent infinite retry loop
        setDesktopAuthorizing(false);
        return;
      }
      setDesktopConnected(true);
    } catch {
      toast.error("Failed to connect desktop app");
      // Don't reset desktopAuthCalled — prevent infinite retry loop
      setDesktopAuthorizing(false);
    }
  }, [deviceId]);

  // OTP verification state
  const [pendingVerification, setPendingVerification] = useState(false);
  const [otp, setOtp] = useState("      ");
  const [verifying, setVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Desktop connected: auto-close countdown
  useEffect(() => {
    if (!desktopConnected) return;
    if (closeCountdown <= 0) {
      window.close();
      return;
    }
    const timer = setTimeout(() => setCloseCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [desktopConnected, closeCountdown]);

  const handleResendOtp = useCallback(async () => {
    if (resendCooldown > 0) return;
    setResendCooldown(RESEND_COOLDOWN);
    try {
      await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      toast.success("Verification code sent");
    } catch {
      toast.error("Failed to resend code");
    }
  }, [email, resendCooldown]);

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = otp.replace(/\s/g, "");
    if (code.length !== OTP_LENGTH) {
      toast.error("Please enter the 6-digit code");
      return;
    }
    setVerifying(true);
    try {
      const { error } = await authClient.emailOtp.verifyEmail({
        email,
        otp: code,
      });
      if (error) {
        toast.error(error.message ?? "Invalid verification code");
        setVerifying(false);
        return;
      }
      // Auto sign in after verification
      if (password) {
        const { error: signInError } = await authClient.signIn.email({
          email,
          password,
        });
        if (signInError) {
          toast.error(signInError.message ?? "Sign in failed");
          setVerifying(false);
          return;
        }
      }
      track(isLogin ? "login_email_success" : "signup_email_success", {
        source: authSourceParam ?? "Landing",
      });
      identify({
        auth_method: "email",
        user_email: email,
        ...(isLogin ? {} : { signup_date: new Date().toISOString() }),
      });
      // Desktop auth is handled by the useEffect watching session changes
      if (!isDesktopAuth) {
        navigate(returnTo);
      }
      setVerifying(false);
    } catch {
      toast.error("Verification failed");
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (authSourceParam) {
      sessionStorage.setItem("nexu_auth_source", authSourceParam);
    }
  }, [authSourceParam]);

  useEffect(() => {
    if (!session?.user) return;
    setUserId(session.user.id);
    const mode = sessionStorage.getItem("nexu_auth_mode");
    const provider = sessionStorage.getItem("nexu_auth_provider");
    const source = sessionStorage.getItem("nexu_auth_source");
    sessionStorage.removeItem("nexu_auth_mode");
    sessionStorage.removeItem("nexu_auth_provider");
    sessionStorage.removeItem("nexu_auth_source");
    if (provider) {
      const event =
        mode === "login"
          ? `login_${provider}_success`
          : `signup_${provider}_success`;
      track(event, { source: source ?? "Landing" });
      identify({
        auth_method: provider,
        user_email: session.user.email,
      });
    }
    const validSources = [
      "email",
      "google",
      "slack_shared_claim",
      "IM",
      "Landing",
    ] as const;
    type AuthSource = (typeof validSources)[number];
    if (source && validSources.includes(source as AuthSource)) {
      postApiV1MeAuthSource({
        body: {
          source: source as AuthSource,
          detail: provider ? `provider:${provider}` : undefined,
        },
      }).catch(() => {
        // Best-effort tracking; do not block login success flow.
      });
    }

    // Desktop auth: authorize the device when session becomes available
    if (isDesktopAuth && deviceId && !desktopConnected) {
      // Reset guard so a fresh session can trigger authorization
      desktopAuthCalled.current = false;
      handleDesktopAuthorize();
    }
  }, [
    session?.user,
    isDesktopAuth,
    deviceId,
    desktopConnected,
    handleDesktopAuthorize,
  ]);

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (session?.user && !isDesktopAuth) {
    return <Navigate to={returnTo} replace />;
  }

  const handleOAuth = async (provider: "google") => {
    setLoading(provider);
    sessionStorage.setItem("nexu_auth_mode", isLogin ? "login" : "signup");
    sessionStorage.setItem("nexu_auth_provider", provider);
    if (authSourceParam) {
      sessionStorage.setItem("nexu_auth_source", authSourceParam);
    }
    try {
      const callbackURL =
        isDesktopAuth && deviceId
          ? `${window.location.origin}/auth?desktop=1&device_id=${encodeURIComponent(deviceId)}`
          : `${window.location.origin}${returnTo}`;
      await authClient.signIn.social({
        provider,
        callbackURL,
      });
    } catch {
      setLoading(null);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading("email");
    try {
      if (isLogin) {
        const { error } = await authClient.signIn.email({
          email,
          password,
        });
        if (error) {
          // If email not verified, resend OTP and show verification screen
          const msg = (error.message ?? "").toLowerCase();
          if (
            msg.includes("email is not verified") ||
            error.code === "EMAIL_NOT_VERIFIED"
          ) {
            await authClient.emailOtp.sendVerificationOtp({
              email,
              type: "email-verification",
            });
            setPendingVerification(true);
            setResendCooldown(RESEND_COOLDOWN);
            setLoading(null);
            toast.info("Please verify your email first");
            return;
          }
          toast.error(error.message ?? "Login failed");
          setLoading(null);
          return;
        }
        track("login_email_success", { source: authSourceParam ?? "Landing" });
        identify({ auth_method: "email", user_email: email });
        // Desktop auth is handled by the useEffect watching session changes
        if (!isDesktopAuth) {
          navigate(returnTo);
        }
        setLoading(null);
      } else {
        const { error } = await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0] || "User",
        });
        if (error) {
          const msg = (error.message ?? "").toLowerCase();
          if (msg.includes("already") || msg.includes("exist")) {
            // Check backend to determine verified vs unverified
            const { data: check } = await postApiAuthCheckEmail({
              body: { email },
            });
            if (!check) {
              toast.error("Failed to check email status");
              setLoading(null);
              return;
            }
            if (check.exists && !check.verified) {
              // Unverified account — resend OTP
              await authClient.emailOtp.sendVerificationOtp({
                email,
                type: "email-verification",
              });
              setPendingVerification(true);
              setResendCooldown(RESEND_COOLDOWN);
              setLoading(null);
              toast.info("Verification code sent to your email");
              return;
            }
            toast.error("This email is already registered. Please log in.");
            setLoading(null);
            return;
          }
          toast.error(error.message ?? "Sign up failed");
          setLoading(null);
          return;
        }
        // Sign up succeeded — switch to OTP verification
        setPendingVerification(true);
        setResendCooldown(RESEND_COOLDOWN);
        setLoading(null);
      }
    } catch {
      toast.error("Something went wrong");
      setLoading(null);
    }
  };

  // Desktop connection success screen
  if (desktopConnected) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0">
        <div className="text-center max-w-[400px] px-6">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-green-500/10 flex items-center justify-center">
            <svg
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-green-500"
              role="img"
              aria-label="Connected"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="text-[22px] font-bold text-text-primary mb-2">
            {t("auth.connected")}
          </h1>
          <p className="text-[14px] text-text-muted leading-relaxed">
            {t("auth.desktopConnected")}
          </p>
          <p className="text-[13px] text-text-muted mt-4">
            {t("auth.autoCloseIn", { seconds: closeCountdown })}
          </p>
        </div>
      </div>
    );
  }

  // Desktop authorizing screen (waiting for API call)
  if (desktopAuthorizing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent mx-auto mb-4" />
          <p className="text-[14px] text-text-muted">
            {t("auth.connectingDesktop")}
          </p>
        </div>
      </div>
    );
  }

  // OTP verification screen
  if (pendingVerification) {
    return (
      <div className="flex min-h-screen">
        <BrandRail onLogoClick={() => navigate("/")} />

        {/* Right panel — OTP form */}
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
              <div className="mb-8 text-center">
                <h1 className="text-[22px] font-bold text-text-primary mb-1.5">
                  {t("auth.checkEmail")}
                </h1>
                <p className="text-[14px] text-text-muted">
                  {t("auth.otpSentTo")}{" "}
                  <span className="font-medium text-text-secondary">
                    {email}
                  </span>
                </p>
              </div>

              <form onSubmit={handleVerifyOtp} className="space-y-6">
                <OtpInput value={otp} onChange={setOtp} disabled={verifying} />

                <button
                  type="submit"
                  disabled={verifying}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[14px] font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {verifying && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("auth.verify")}
                </button>
              </form>

              <div className="text-center mt-6">
                <span className="text-[13px] text-text-muted">
                  {t("auth.didntReceive")}{" "}
                </span>
                {resendCooldown > 0 ? (
                  <span className="text-[13px] text-text-muted">
                    {t("auth.resendIn", { seconds: resendCooldown })}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    className="text-[13px] text-accent font-medium hover:underline underline-offset-2"
                  >
                    {t("auth.resendCode")}
                  </button>
                )}
              </div>

              <div className="text-center mt-4">
                <button
                  type="button"
                  onClick={() => {
                    setPendingVerification(false);
                    setOtp("      ");
                  }}
                  className="text-[13px] text-text-muted hover:text-text-secondary transition-colors"
                >
                  &larr; {t("auth.backToSignup")}
                </button>
              </div>
            </div>
          </div>

          <div
            className="flex items-center justify-center gap-3 px-4 sm:px-6 pt-3 pb-4 text-[11px] text-text-muted"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors"
            >
              {t("auth.terms")}
            </a>
            <span className="text-border">&middot;</span>
            <a
              href="/privacy"
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

  return (
    <div className="min-h-screen flex">
      <BrandRail onLogoClick={() => navigate("/")} />

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col bg-surface-0 relative overflow-hidden">
        {/* Subtle grid bg */}
        <div
          className="absolute inset-0 opacity-[0.06] pointer-events-none"
          style={{
            backgroundImage:
              "linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />

        {/* Mobile-only nav */}
        <nav className="lg:hidden relative z-10 flex items-center px-6 sm:px-10 h-14 shrink-0">
          <Link to="/" className="flex items-center gap-2.5">
            <BrandMark className="w-7 h-7 shrink-0" />
            <span className="text-sm font-semibold tracking-tight text-text-primary">
              Nexu
            </span>
          </Link>
        </nav>

        {/* Center card */}
        <div className="relative z-10 flex-1 flex items-center justify-center px-5 py-8">
          <div className="w-full max-w-[380px]">
            <div className="bg-surface-1 border border-border rounded-2xl p-7 sm:p-8 shadow-[0_2px_8px_rgba(0,0,0,0.04)]">
              {/* Header */}
              <div className="text-center mb-7">
                {isDesktopAuth && (
                  <div className="mb-4 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20">
                    <p className="text-[13px] text-accent font-medium">
                      {t("auth.desktopConnectPrompt")}
                    </p>
                  </div>
                )}
                <h2 className="text-[18px] font-semibold text-text-primary tracking-tight">
                  {isLogin ? t("auth.welcomeBack") : t("auth.createAccount")}
                </h2>
                <p className="mt-1.5 text-[13px] text-text-muted">
                  {isLogin ? t("auth.loginToContinue") : t("auth.chooseMethod")}
                </p>
              </div>

              {/* Auth buttons */}
              <div className="space-y-2.5">
                {/* Google */}
                <button
                  type="button"
                  onClick={() => handleOAuth("google")}
                  disabled={loading !== null}
                  className="group flex items-center justify-center gap-2 w-full h-11 rounded-lg text-[14px] font-medium border border-border bg-surface-0 text-text-primary hover:bg-surface-2 hover:border-border-hover active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {loading === "google" ? (
                    <div className="w-4 h-4 border-2 border-text-muted/30 border-t-text-secondary rounded-full animate-spin" />
                  ) : (
                    <>
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        className="shrink-0"
                        aria-hidden="true"
                      >
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      <span>{t("auth.continueGoogle")}</span>
                      <ArrowRight
                        size={14}
                        className="opacity-0 -ml-1 group-hover:opacity-60 group-hover:ml-0 transition-all"
                      />
                    </>
                  )}
                </button>

                {/* Divider */}
                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 border-t border-border" />
                  <span className="text-[11px] text-text-muted uppercase tracking-wider select-none">
                    {t("auth.or")}
                  </span>
                  <div className="flex-1 border-t border-border" />
                </div>

                {/* Email — collapsible */}
                {showEmailForm ? (
                  <div>
                    <form onSubmit={handleEmailAuth} className="space-y-2.5">
                      {!isLogin && (
                        <input
                          type="text"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder={t("auth.namePlaceholder")}
                          className="w-full h-11 px-3.5 rounded-lg border border-border bg-surface-0 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-tertiary focus:ring-1 focus:ring-text-muted/20 transition-colors"
                        />
                      )}
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t("auth.emailPlaceholder")}
                        required
                        className="w-full h-11 px-3.5 rounded-lg border border-border bg-surface-0 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-tertiary focus:ring-1 focus:ring-text-muted/20 transition-colors"
                      />
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t("auth.passwordPlaceholder")}
                        required
                        minLength={8}
                        className="w-full h-11 px-3.5 rounded-lg border border-border bg-surface-0 text-[14px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-text-tertiary focus:ring-1 focus:ring-text-muted/20 transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={loading !== null}
                        className="flex items-center justify-center w-full h-11 rounded-lg text-[14px] font-medium bg-[#111] text-white hover:bg-[#222] active:scale-[0.98] transition-all disabled:opacity-40 cursor-pointer"
                      >
                        {loading === "email" ? (
                          <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <span>
                            {isLogin
                              ? t("auth.loginButton")
                              : t("auth.createAccountButton")}
                          </span>
                        )}
                      </button>
                    </form>
                    <button
                      type="button"
                      onClick={() => setShowEmailForm(false)}
                      className="w-full mt-3 text-[12px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                    >
                      {t("auth.otherMethods")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowEmailForm(true)}
                    className="flex items-center justify-center gap-2 w-full h-11 rounded-lg text-[14px] font-medium border border-border bg-surface-0 text-text-primary hover:bg-surface-2 hover:border-border-hover active:scale-[0.98] transition-all cursor-pointer"
                  >
                    <Mail size={15} />
                    <span>
                      {isLogin ? t("auth.emailLogin") : t("auth.emailRegister")}
                    </span>
                  </button>
                )}
              </div>

              {/* Toggle login/register */}
              <div className="flex items-center justify-center gap-1.5 mt-6 pt-5 border-t border-border">
                <span className="text-[13px] text-text-muted">
                  {isLogin ? t("auth.noAccount") : t("auth.hasAccount")}
                </span>
                <Link
                  to={(() => {
                    const p = new URLSearchParams(searchParams);
                    if (isLogin) {
                      p.set("mode", "signup");
                    } else {
                      p.delete("mode");
                    }
                    return `/auth?${p.toString()}`;
                  })()}
                  onClick={() => {
                    setShowEmailForm(false);
                  }}
                  className="text-[13px] text-text-primary font-medium hover:underline underline-offset-2"
                >
                  {isLogin ? t("auth.signUp") : t("auth.logIn")}
                </Link>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-center gap-4 mt-6 text-[12px] text-text-muted">
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-text-secondary transition-colors"
              >
                {t("auth.terms")}
              </a>
              <span className="text-border select-none">&middot;</span>
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-text-secondary transition-colors"
              >
                {t("auth.privacy")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
