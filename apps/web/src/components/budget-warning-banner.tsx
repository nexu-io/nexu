import { cn } from "@/lib/utils";
import { X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export interface BudgetWarningBannerProps {
  status: "warning" | "depleted";
  onDismiss: () => void;
}

export function BudgetWarningBanner({
  status,
  onDismiss,
}: BudgetWarningBannerProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isDepleted = status === "depleted";

  return (
    <div
      className={cn(
        "relative rounded-[18px] border px-5 py-4",
        isDepleted
          ? "border-[#f5c6c0] bg-[linear-gradient(135deg,#fff5f4_0%,#fff0ee_100%)]"
          : "border-[#f5dfa0] bg-[linear-gradient(135deg,#fffbec_0%,#fff8dc_100%)]",
      )}
    >
      {/* Dismiss button */}
      <button
        type="button"
        onClick={onDismiss}
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full text-current opacity-50 transition-opacity hover:opacity-80"
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>

      <div className="flex flex-col gap-3 pr-6 sm:flex-row sm:items-center sm:gap-5">
        {/* Title + description */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div
            className={cn(
              "flex items-center gap-1.5 text-[13px] font-semibold",
              isDepleted ? "text-[#9b2c1e]" : "text-[#7a5a08]",
            )}
          >
            <Zap
              size={14}
              className={isDepleted ? "text-[#d94f3d]" : "text-[#b07d12]"}
            />
            {isDepleted
              ? t("budget.banner.depletedTitle")
              : t("budget.banner.warningTitle")}
          </div>
          <p
            className={cn(
              "text-[12px] leading-[1.6]",
              isDepleted ? "text-[#7a3b32]" : "text-[#6b5010]",
            )}
          >
            {t("budget.banner.description")}
          </p>
        </div>

        {/* CTA buttons */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/workspace/rewards")}
            className={cn(
              "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
              isDepleted
                ? "bg-[#d94f3d] text-white hover:bg-[#c0392b]"
                : "bg-[#b07d12] text-white hover:bg-[#9a6d0f]",
            )}
          >
            {t("budget.banner.earnCredits")}
          </button>
          <button
            type="button"
            onClick={() => navigate("/workspace/settings")}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-[12px] font-medium transition-colors",
              isDepleted
                ? "border-[#d94f3d] text-[#9b2c1e] hover:bg-[#fff0ee]"
                : "border-[#b07d12] text-[#7a5a08] hover:bg-[#fffbec]",
            )}
          >
            {t("budget.banner.byok")}
          </button>
        </div>
      </div>
    </div>
  );
}
