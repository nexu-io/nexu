import { BrandMark } from "@/components/brand-mark";
import { authClient } from "@/lib/auth-client";
import { identify, setUserId, track } from "@/lib/tracking";
import "@/lib/api";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { postApiV1MeAuthSource } from "../../lib/api/sdk.gen";

const CAPABILITY_PILLS = [
  { emoji: "\u{1F4BB}", label: "Code & Deploy" },
  { emoji: "\u{1F4CA}", label: "Data Analysis" },
  { emoji: "\u270D\uFE0F", label: "Content" },
  { emoji: "\u{1F50D}", label: "Research" },
  { emoji: "\u2699\uFE0F", label: "Automation" },
];

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [desktopConnected, setDesktopConnected] = useState(false);
  const [desktopAuthorizing, setDesktopAuthorizing] = useState(false);
  const desktopAuthCalled = useRef(false);

  /** After login, authorize the desktop device and show success screen. */
  const handleDesktopAuthorize = useCallback(async () => {
    if (!deviceId || desktopAuthCalled.current) return;
    desktopAuthCalled.current = true;
    setDesktopAuthorizing(true);
    try {
      const res = await fetch("/api/v1/auth/desktop-authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ deviceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Unknown error" }));
        toast.error(
          (body as { error?: string }).error ?? "Failed to connect desktop",
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
            const res = await fetch("/api/auth/check-email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email }),
            });
            const check = (await res.json()) as {
              exists: boolean;
              verified: boolean;
            };
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
            Connected!
          </h1>
          <p className="text-[14px] text-text-muted leading-relaxed">
            Your Nexu Desktop app is now connected to your cloud account. You
            can close this tab and return to the desktop app.
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
            Connecting your desktop app...
          </p>
        </div>
      </div>
    );
  }

  // OTP verification screen
  if (pendingVerification) {
    return (
      <div className="flex min-h-screen">
        {/* Left panel — dark */}
        <div className="hidden lg:flex w-[400px] shrink-0 bg-[#111111] flex-col justify-between p-8 relative overflow-hidden">
          <div className="flex items-center gap-2.5">
            <BrandMark className="w-7 h-7 shrink-0" />
            <span className="text-[14px] font-semibold text-white/90">
              Nexu
            </span>
          </div>
          <div>
            <h2 className="text-[32px] font-bold text-white leading-[1.15] mb-4">
              Your digital
              <br />
              coworker,
              <br />
              always on.
            </h2>
            <p className="text-[13px] text-white/45 leading-relaxed mb-6 max-w-[280px]">
              AI avatars that live in Slack — not just chatting, but delivering
              real results. Build apps, analyze data, write content, run
              automations.
            </p>
            <div className="flex flex-wrap gap-2">
              {CAPABILITY_PILLS.map((p) => (
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
          <div className="text-[11px] text-white/20">
            &copy; 2026 Nexu by Refly
          </div>
        </div>

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
                  Check your email
                </h1>
                <p className="text-[14px] text-text-muted">
                  We sent a 6-digit code to{" "}
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
                  Verify
                </button>
              </form>

              <div className="text-center mt-6">
                <span className="text-[13px] text-text-muted">
                  Didn't receive a code?{" "}
                </span>
                {resendCooldown > 0 ? (
                  <span className="text-[13px] text-text-muted">
                    Resend in {resendCooldown}s
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={handleResendOtp}
                    className="text-[13px] text-accent font-medium hover:underline underline-offset-2"
                  >
                    Resend code
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
                  &larr; Back to sign up
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
              Terms of Service
            </a>
            <span className="text-border">&middot;</span>
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text-secondary transition-colors"
            >
              Privacy Policy
            </a>
            <span className="text-border">&middot;</span>
            <span>&copy; 2026 Nexu by Refly</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Left panel — dark */}
      <div className="hidden lg:flex w-[400px] shrink-0 bg-[#111111] flex-col justify-between p-8 relative overflow-hidden">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <BrandMark className="w-7 h-7 shrink-0" />
          <span className="text-[14px] font-semibold text-white/90">Nexu</span>
        </div>

        {/* Main copy */}
        <div>
          <h2 className="text-[32px] font-bold text-white leading-[1.15] mb-4">
            Your digital
            <br />
            coworker,
            <br />
            always on.
          </h2>
          <p className="text-[13px] text-white/45 leading-relaxed mb-6 max-w-[280px]">
            AI avatars that live in Slack — not just chatting, but delivering
            real results. Build apps, analyze data, write content, run
            automations.
          </p>

          {/* Capability pills */}
          <div className="flex flex-wrap gap-2">
            {CAPABILITY_PILLS.map((p) => (
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

        {/* Footer */}
        <div className="text-[11px] text-white/20">
          &copy; 2026 Nexu by Refly
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col bg-surface-0">
        {/* Mobile-only nav */}
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
            {/* Header */}
            <div className="mb-8">
              {isDesktopAuth && (
                <div className="mb-4 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20">
                  <p className="text-[13px] text-accent font-medium">
                    Log in to connect your Nexu Desktop app
                  </p>
                </div>
              )}
              <h1 className="text-[22px] font-bold text-text-primary mb-1.5">
                {isLogin ? "Welcome back" : "Create your account"}
              </h1>
              <p className="text-[14px] text-text-muted">
                {isLogin
                  ? "Log in to your digital clone"
                  : "Sign up to get your Nexu digital clone"}
              </p>
            </div>

            {/* OAuth buttons */}
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => handleOAuth("google")}
                disabled={loading !== null}
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg text-[14px] font-medium bg-[#111111] text-white hover:bg-[#222222] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading === "google" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
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
                    Continue with Google
                  </>
                )}
              </button>
            </div>

            {/* Divider */}
            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-[12px]">
                <span className="bg-surface-0 px-3 text-text-muted">or</span>
              </div>
            </div>

            {/* Email form */}
            <form onSubmit={handleEmailAuth} className="space-y-3">
              {!isLogin && (
                <div className="space-y-1.5">
                  <label
                    htmlFor="auth-name"
                    className="text-[12px] text-text-secondary font-medium"
                  >
                    Name
                  </label>
                  <input
                    id="auth-name"
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-2.5 text-[13px] rounded-lg border border-border bg-surface-1 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-all"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <label
                  htmlFor="auth-email"
                  className="text-[12px] text-text-secondary font-medium"
                >
                  Email
                </label>
                <input
                  id="auth-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-3 py-2.5 text-[13px] rounded-lg border border-border bg-surface-1 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-all"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="auth-password"
                  className="text-[12px] text-text-secondary font-medium"
                >
                  Password
                </label>
                <input
                  id="auth-password"
                  type="password"
                  placeholder="Min 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-3 py-2.5 text-[13px] rounded-lg border border-border bg-surface-1 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/10 transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={loading !== null}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[14px] font-medium bg-accent text-accent-fg hover:bg-accent-hover transition-all disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading === "email" && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {isLogin ? "Log in" : "Create account"}
              </button>
            </form>

            {/* Toggle mode */}
            <div className="text-center mt-6">
              <span className="text-[13px] text-text-muted">
                {isLogin
                  ? "Don't have an account?"
                  : "Already have an account?"}
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
                className="text-[13px] text-accent font-medium ml-1 hover:underline underline-offset-2"
              >
                {isLogin ? "Sign up" : "Log in"}
              </Link>
            </div>
          </div>
        </div>

        {/* Footer */}
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
            Terms of Service
          </a>
          <span className="text-border">&middot;</span>
          <a
            href="/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-text-secondary transition-colors"
          >
            Privacy Policy
          </a>
          <span className="text-border">&middot;</span>
          <span>&copy; 2026 Nexu by Refly</span>
        </div>
      </div>
    </div>
  );
}
