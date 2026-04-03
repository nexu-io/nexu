import { cn } from "@/lib/utils";
import { Gift, Settings2, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export interface BudgetWarningBannerProps {
  status: "warning" | "depleted";
  onDismiss: () => void;
  dismissible?: boolean;
}

const statusConfig = {
  warning: {
    headlineKey: "budget.banner.warningHeadline",
    border: "border-[var(--color-warning)]/25",
    bg: "bg-[var(--color-warning)]/6",
    accentColor: "var(--color-warning)",
    primaryClass: "bg-[#EDC337] text-[#3B2F0B] hover:bg-[#dfb72e]",
  },
  depleted: {
    headlineKey: "budget.banner.depletedHeadline",
    border: "border-[var(--color-danger)]/25",
    bg: "bg-[var(--color-danger)]/6",
    accentColor: "var(--color-danger)",
    primaryClass: "bg-[#F93920] text-white hover:bg-[#ea311a]",
  },
} as const;

export function BudgetWarningBanner({
  status,
  onDismiss,
  dismissible = true,
}: BudgetWarningBannerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const config = statusConfig[status];
  const buttonClass =
    "inline-flex items-center justify-center gap-1.5 rounded-[8px] px-[14px] py-[5px] text-[12px] font-medium transition-colors";

  return (
    <div
      data-budget-banner-status={status}
      className={cn(
        "relative rounded-xl border px-5 py-4",
        config.border,
        config.bg,
      )}
    >
      {dismissible ? (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-black/8 hover:text-text-secondary"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      ) : null}

      <div className="pr-4">
        <div className="flex items-start gap-3">
          <div
            className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px]"
            style={{
              background: `color-mix(in srgb, ${config.accentColor} 15%, transparent)`,
            }}
          >
            <Zap size={14} style={{ color: config.accentColor }} />
          </div>
          <div className="pt-[3px] text-[13px] font-semibold leading-snug">
            <span style={{ color: config.accentColor }}>
              {t(config.headlineKey)}
            </span>
          </div>
        </div>

        <div className="mt-3 pl-10">
          <div className="mb-1.5 text-[11px] text-text-tertiary">
            {t("budget.banner.actionsLabel")}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate("/workspace/rewards")}
              className={cn(buttonClass, config.primaryClass)}
            >
              <Gift size={12} />
              {t("budget.banner.earnCredits")}
            </button>
            <button
              type="button"
              onClick={() => navigate("/workspace/models?tab=providers")}
              className={cn(
                buttonClass,
                "border border-border bg-white text-text-secondary hover:bg-surface-1",
              )}
            >
              <Settings2 size={12} />
              {t("budget.banner.byok")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
