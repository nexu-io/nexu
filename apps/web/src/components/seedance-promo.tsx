import { track } from "@/lib/tracking";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock,
  ExternalLink,
  Sparkles,
  Star,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export const SEEDANCE_PROMO_DEADLINE = new Date("2026-04-07T23:59:59+08:00");
export const SEEDANCE_PROMO_DISMISS_KEY = "nexu_seedance_promo_dismissed";
export const SEEDANCE_PROMO_CYCLE_MS = 2 * 24 * 60 * 60 * 1000;
export const SEEDANCE_PROMO_CYCLE_START = new Date("2026-04-01T00:00:00+08:00");

export const SEEDANCE_GITHUB_URL = "https://github.com/nexu-io/nexu";
export const SEEDANCE_FEISHU_GROUP_URL =
  "https://applink.feishu.cn/client/chat/chatter/add_by_link?link_token=9bdse1f7-cd4c-4715-bfdd-cee2bd15263f";
export const SEEDANCE_TUTORIAL_URL = "https://docs.nexu.io/zh/guide/seedance";

export function getSeedancePromoCountdown(
  now: number,
  cycleStart = SEEDANCE_PROMO_CYCLE_START,
  cycleMs = SEEDANCE_PROMO_CYCLE_MS,
) {
  const cycleStartMs = cycleStart.getTime();
  const elapsed = Math.max(0, now - cycleStartMs);
  const cycleProgress = elapsed % cycleMs;
  const remaining =
    cycleProgress === 0 ? cycleMs - 1000 : cycleMs - cycleProgress;
  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return {
    remaining,
    days,
    hours,
    minutes,
    seconds,
    totalSeconds,
    compactLabel: `${String(days).padStart(2, "0")}天 ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`,
  };
}

function SeedanceCountdownChip({ now }: { now: number }) {
  const countdown = getSeedancePromoCountdown(now);

  return (
    <div
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold leading-none shadow-sm tabular-nums"
      style={{
        color: "white",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--color-warning) 82%, white), color-mix(in srgb, var(--color-danger) 78%, var(--color-warning) 22%))",
        borderColor:
          "color-mix(in srgb, var(--color-danger) 56%, var(--color-warning) 32%, white)",
        boxShadow: "var(--shadow-focus)",
      }}
    >
      <Clock size={10} className="shrink-0" />
      <span>{countdown.compactLabel}</span>
    </div>
  );
}

/* ── Banner ── */

export function SeedancePromoBanner({
  onOpen,
  onDismiss,
  isDismissed,
}: {
  onOpen: () => void;
  onDismiss: () => void;
  isDismissed: boolean;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  if (isDismissed) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: banner with nested interactive elements
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        track("workspace_seedance_promo_open", { source: "banner" });
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          track("workspace_seedance_promo_open", { source: "banner" });
          onOpen();
        }
      }}
      className="group relative w-full overflow-hidden rounded-xl border border-[var(--color-warning)]/25 text-left transition-all hover:shadow-[var(--shadow-card)]"
      style={{
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--color-warning) 16%, white), color-mix(in srgb, var(--color-brand-primary) 10%, white))",
      }}
    >
      <div className="flex items-start gap-3 px-4 py-3.5 pr-11">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-white/50 bg-white/80">
          <span className="text-[18px] leading-none">🎬</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-text-primary">
              {t("home.seedance.promo.title")}
            </span>
            <SeedanceCountdownChip now={now} />
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">
            {t("home.seedance.promo.subtitle")}
          </p>
        </div>
        <ArrowRight
          size={14}
          className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
        />
      </div>
      <button
        type="button"
        aria-label={t("home.seedance.promo.dismiss")}
        onClick={(e) => {
          e.stopPropagation();
          track("workspace_seedance_promo_dismiss", { source: "banner" });
          onDismiss();
        }}
        className="absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/70 hover:text-text-primary"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/* ── Modal ── */

export function SeedancePromoModal({
  open,
  onClose,
  shouldAutoAdvanceAfterStar,
}: {
  open: boolean;
  onClose: () => void;
  shouldAutoAdvanceAfterStar: boolean;
}) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2>(1);
  const [now, setNow] = useState(() => Date.now());
  const autoAdvanceRef = useRef<number | null>(null);
  const [hasStarred, setHasStarred] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setHasStarred(false);
  }, [open]);

  useEffect(() => {
    if (open) return;
    if (autoAdvanceRef.current) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [open]);

  useEffect(
    () => () => {
      if (autoAdvanceRef.current) window.clearTimeout(autoAdvanceRef.current);
    },
    [],
  );

  const handleStarClick = useCallback(() => {
    track("workspace_seedance_promo_github_click", { source: "modal" });
    window.open(SEEDANCE_GITHUB_URL, "_blank", "noopener,noreferrer");
    setHasStarred(true);
    if (shouldAutoAdvanceAfterStar) {
      if (autoAdvanceRef.current) window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = window.setTimeout(() => setStep(2), 2000);
    }
  }, [shouldAutoAdvanceAfterStar]);

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceRef.current) {
      window.clearTimeout(autoAdvanceRef.current);
      autoAdvanceRef.current = null;
    }
  }, []);

  if (!open) return null;

  const stepDots: Array<1 | 2> = [1, 2];
  const stepTitle =
    step === 1
      ? t("home.seedance.modal.step1.title")
      : t("home.seedance.modal.step2.title");

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center">
      <button
        type="button"
        aria-label="Close promo modal"
        className="absolute inset-0 bg-black/50 backdrop-blur-[4px]"
        onClick={() => {
          clearAutoAdvance();
          onClose();
        }}
      />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation only, no keyboard action needed */}
      <div
        className="relative w-full max-w-[348px] mx-4 overflow-hidden rounded-2xl border border-border bg-surface-1 shadow-[0_24px_64px_rgba(0,0,0,0.24),0_0_0_1px_rgba(0,0,0,0.06)]"
        style={{ animation: "scaleIn 220ms cubic-bezier(0.16,1,0.3,1)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          type="button"
          onClick={() => {
            clearAutoAdvance();
            onClose();
          }}
          className="absolute right-3.5 top-3.5 z-20 flex h-6 w-6 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/70 hover:text-text-primary"
        >
          <X size={13} />
        </button>

        {/* Header */}
        <div
          className="relative border-b"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in srgb, var(--color-warning) 16%, white), color-mix(in srgb, var(--color-brand-primary) 8%, white))",
            borderColor: "color-mix(in srgb, var(--color-warning) 18%, white)",
          }}
        >
          <div
            className="absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(circle at top right, color-mix(in srgb, var(--color-brand-primary) 12%, transparent), transparent 45%)",
            }}
          />
          <div className="relative px-5 pb-4 pt-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 rounded-full border border-white/60 bg-white/75 px-2.5 py-1 text-[10px] font-semibold leading-none text-[var(--color-warning)] shadow-sm">
                <Sparkles size={10} />
                {t("home.seedance.promo.badge")}
              </div>
              <SeedanceCountdownChip now={now} />
            </div>
            <div className="mt-3">
              <h2 className="text-[18px] font-semibold leading-tight text-text-primary">
                {t("home.seedance.modal.title")}
              </h2>
              <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                {t("home.seedance.modal.lead")}
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 pb-5 pt-4">
          {/* Step indicator + title */}
          <div className="mb-4 flex items-center justify-between">
            <div className="text-[14px] font-semibold text-text-primary">
              {stepTitle}
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {stepDots.map((s) => (
                <div
                  key={s}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    s === step
                      ? "w-5 bg-[var(--color-brand-primary)]"
                      : s < step
                        ? "w-2 bg-[var(--color-brand-primary)]/40"
                        : "w-2 bg-border",
                  )}
                />
              ))}
            </div>
          </div>

          {/* Step 1: GitHub Star */}
          {step === 1 && (
            <>
              <div
                className="mb-4 rounded-[12px] border px-4 py-3"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-warning) 7%, white)",
                  borderColor:
                    "color-mix(in srgb, var(--color-warning) 16%, white)",
                }}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border"
                    style={{
                      background:
                        "color-mix(in srgb, var(--color-warning) 12%, white)",
                      borderColor:
                        "color-mix(in srgb, var(--color-warning) 18%, white)",
                    }}
                  >
                    <Star
                      size={18}
                      className="fill-[var(--color-warning)] text-[var(--color-warning)]"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] leading-relaxed text-text-muted">
                      {t("home.seedance.modal.step1.copy")}
                    </div>
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={handleStarClick}
                className={cn(
                  "mb-2.5 flex w-full items-center justify-center gap-2 rounded-[10px] text-[13px] font-semibold transition-colors h-[40px]",
                  hasStarred
                    ? "border border-border bg-surface-1 text-text-secondary hover:bg-surface-2"
                    : "bg-[#24292f] text-white hover:bg-[#1c2026]",
                )}
              >
                {hasStarred ? (
                  <Check size={13} className="text-[var(--color-success)]" />
                ) : (
                  <Star size={13} className="fill-amber-400 text-amber-400" />
                )}
                {hasStarred
                  ? t("home.seedance.modal.step1.done")
                  : t("home.seedance.modal.step1.cta")}
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={!hasStarred}
                className={cn(
                  "w-full rounded-[10px] text-[12px] font-medium transition-colors",
                  hasStarred
                    ? "h-[40px] bg-[#24292f] text-white hover:bg-[#1c2026]"
                    : "h-[38px] border border-border text-text-secondary opacity-30 cursor-not-allowed",
                )}
              >
                {t("home.seedance.modal.step1.nextCta")}
              </button>
            </>
          )}

          {/* Step 2: Join Feishu Group */}
          {step === 2 && (
            <>
              <p className="mb-4 text-[12px] leading-relaxed text-text-secondary">
                {t("home.seedance.modal.step2.copy")}
              </p>
              <button
                type="button"
                onClick={() =>
                  window.open(
                    SEEDANCE_TUTORIAL_URL,
                    "_blank",
                    "noopener,noreferrer",
                  )
                }
                className="mb-3 inline-flex w-full items-center justify-center gap-1.5 text-[12px] font-medium text-[var(--color-brand-primary)] hover:underline"
              >
                <ArrowUpRight size={12} />
                {t("home.seedance.modal.step2.tutorial")}
              </button>
              <a
                href={SEEDANCE_FEISHU_GROUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  track("workspace_seedance_promo_feishu_click", {
                    source: "modal",
                  })
                }
                className="mb-2.5 flex h-[40px] w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--color-brand-primary)] text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              >
                <ExternalLink size={13} />
                {t("home.seedance.modal.step2.cta")}
              </a>
              <button
                type="button"
                onClick={onClose}
                className="w-full h-[36px] rounded-[10px] text-[12px] text-text-muted transition-colors hover:bg-surface-2 hover:text-text-secondary"
              >
                {t("home.seedance.modal.step2.done", "好的，已了解")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
