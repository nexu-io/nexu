import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/tracking";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  LogOut,
} from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import "@/lib/api";
import { getApiV1Me, postApiV1InviteValidate } from "../../lib/api/sdk.gen";

const CAPABILITY_PILLS = [
  { emoji: "\u{1F4BB}", label: "Code & Deploy" },
  { emoji: "\u{1F4CA}", label: "Data Analysis" },
  { emoji: "\u270D\uFE0F", label: "Content" },
  { emoji: "\u{1F50D}", label: "Research" },
  { emoji: "\u2699\uFE0F", label: "Automation" },
];

export function InvitePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await getApiV1Me();
      return data;
    },
  });

  const mutation = useMutation({
    mutationFn: async (inviteCode: string) => {
      const { data, error } = await postApiV1InviteValidate({
        body: { code: inviteCode },
      });
      if (error) throw new Error("Validation failed");
      return data;
    },
    onSuccess: (data) => {
      if (data?.valid) {
        track("invite_success");
        setSuccess(true);
        setTimeout(() => navigate("/onboarding"), 1200);
      } else {
        setError(data?.message ?? "Invalid invite code. Please try again.");
      }
    },
    onError: () => {
      setError("Failed to validate invite code");
    },
  });

  if (profileLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (profile?.inviteAccepted) {
    if (!profile.onboardingCompleted) {
      return <Navigate to="/onboarding" replace />;
    }
    return <Navigate to="/workspace" replace />;
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
    setCode(pasted);
    setError("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = code.trim().toUpperCase();
    if (!value) {
      setError("Please enter an invite code");
      return;
    }
    setError("");
    mutation.mutate(value);
  };

  return (
    <div className="flex min-h-screen">
      {/* Left panel — dark */}
      <div className="hidden lg:flex w-[400px] shrink-0 bg-[#111111] flex-col justify-between p-8 relative overflow-hidden">
        <div className="flex items-center gap-2.5">
          <BrandMark className="w-7 h-7 shrink-0" />
          <span className="text-[14px] font-semibold text-white/90">nexu</span>
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

      {/* Right panel — form */}
      <div className="flex-1 flex flex-col bg-surface-0">
        <nav>
          <div className="flex items-center justify-between px-4 sm:px-6 h-14">
            <Link to="/" className="flex items-center gap-2.5 lg:invisible">
              <BrandMark className="w-7 h-7 shrink-0" />
              <span className="text-sm font-semibold tracking-tight text-text-primary">
                Nexu
              </span>
            </Link>
            <button
              type="button"
              onClick={async () => {
                await authClient.signOut();
                navigate("/");
              }}
              className="flex items-center gap-1.5 text-[13px] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        </nav>

        <div className="flex-1 flex items-center justify-center px-4 sm:px-6 py-8 sm:py-12">
          <div className="w-full max-w-[360px]">
            {success ? (
              <div className="text-center">
                <div className="flex justify-center items-center mx-auto mb-5 w-16 h-16 rounded-2xl bg-[var(--color-success-muted)]">
                  <CheckCircle2
                    size={32}
                    className="text-[var(--color-success)]"
                  />
                </div>
                <h1 className="mb-2 text-2xl font-bold text-text-primary">
                  Welcome to Nexu!
                </h1>
                <p className="mb-4 text-sm text-text-muted">
                  Invite code verified. Activating your digital clone...
                </p>
                <div className="mx-auto w-6 h-6 rounded-full border-2 animate-spin border-accent/30 border-t-accent" />
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="mb-8">
                  <h1 className="text-[22px] font-bold text-text-primary mb-1.5">
                    Welcome
                  </h1>
                  <p className="text-[14px] text-text-muted">
                    Enter your invite code to get started
                  </p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label className="text-[13px] font-medium text-text-secondary">
                      Invite code
                    </Label>
                    <Input
                      type="text"
                      value={code}
                      onChange={(e) => {
                        setCode(e.target.value.toUpperCase());
                        setError("");
                      }}
                      onPaste={handlePaste}
                      placeholder="e.g. NEXU2026"
                      autoFocus
                      className={`px-4 py-3 h-auto text-[14px] font-mono tracking-wide bg-surface-1 text-text-primary placeholder:text-text-muted placeholder:tracking-normal placeholder:font-normal ${
                        error
                          ? "border-red-500/50 focus-visible:border-red-500/50 focus-visible:ring-red-500/10"
                          : "border-border focus-visible:border-accent/50 focus-visible:ring-accent/10"
                      }`}
                    />
                    {error && (
                      <div className="flex items-center gap-1.5 mt-0.5 text-[13px] text-red-500">
                        <AlertCircle size={14} />
                        {error}
                      </div>
                    )}
                  </div>

                  <Button
                    type="submit"
                    disabled={mutation.isPending}
                    className="w-full py-3 h-auto text-[14px] font-semibold bg-[#111111] hover:bg-[#222222] text-white"
                  >
                    {mutation.isPending ? (
                      <div className="w-4 h-4 rounded-full border-2 animate-spin border-white/30 border-t-white" />
                    ) : (
                      <>
                        Continue <ArrowRight size={14} />
                      </>
                    )}
                  </Button>
                </form>

                {/* Discord */}
                <div className="mt-10 pt-8 border-t border-border">
                  <a
                    href="https://discord.gg/Q6AxCUuMNU"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-4 p-4 rounded-xl border border-border bg-surface-1 hover:border-border-hover transition-all group"
                  >
                    <div className="flex justify-center items-center w-10 h-10 rounded-xl bg-[#5865F2] shrink-0">
                      <svg
                        width="18"
                        height="14"
                        viewBox="0 0 71 55"
                        fill="white"
                        aria-hidden="true"
                      >
                        <path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.7 40.7 0 00-1.8 3.7 54 54 0 00-16.2 0A37.4 37.4 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5a.2.2 0 00-.1 0C1.5 18.7-.9 32 .3 45.1v.1a58.7 58.7 0 0017.9 9.1.2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.2 0l1.1.9a.2.2 0 010 .3 36.3 36.3 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.9.2.2 0 00.2.1A58.5 58.5 0 0070.3 45.2v-.1c1.4-15-2.3-28-9.8-39.6a.2.2 0 00-.1-.1zM23.7 37c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7zm23.2 0c-3.4 0-6.3-3.2-6.3-7s2.8-7 6.3-7 6.4 3.2 6.3 7-2.8 7-6.3 7z" />
                      </svg>
                    </div>
                    <div className="text-left">
                      <div className="text-[13px] font-semibold text-text-primary">
                        Don't have an invite code?
                      </div>
                      <div className="text-[13px] text-text-muted group-hover:text-accent transition-colors">
                        Join our Discord to get one &rarr;
                      </div>
                    </div>
                  </a>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
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
            Terms of Service
          </a>
          <span className="text-border">&middot;</span>
          <a
            href="https://nexu.io/privacy"
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
