import { Gift, Settings2, X, Zap } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

export interface BudgetDepletedDialogProps {
  onDismiss: () => void;
}

export function BudgetDepletedDialog({ onDismiss }: BudgetDepletedDialogProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const titleId = useId();
  const descriptionId = useId();
  const buttonClass =
    "inline-flex items-center justify-center gap-1.5 rounded-[10px] px-[14px] py-[8px] text-[12px] font-medium transition-colors";

  return (
    <div
      data-budget-dialog-status="depleted"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop dismiss is supplementary to the close button */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onDismiss}
      />
      <dialog
        open
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-[460px] overflow-hidden rounded-2xl border border-[var(--color-danger)]/20 bg-white shadow-2xl"
      >
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-4 top-4 z-10 flex h-8 w-8 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-1 hover:text-text-primary"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>

        <div className="border-b border-border/70 bg-[linear-gradient(135deg,rgba(249,57,32,0.12),rgba(249,57,32,0.03))] px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[rgba(249,57,32,0.12)]">
              <Zap size={18} className="text-[var(--color-danger)]" />
            </div>
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--color-danger)]/80">
                {t("budget.banner.depletedTitle")}
              </div>
              <h2
                id={titleId}
                className="mt-1 text-[18px] font-semibold leading-tight text-text-primary"
              >
                {t("budget.banner.depletedHeadline")}
              </h2>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 py-5">
          <p
            id={descriptionId}
            className="text-[13px] leading-6 text-text-secondary"
          >
            {t("budget.banner.depletedDescription")}
          </p>

          <div>
            <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-text-muted">
              {t("budget.banner.actionsLabel")}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => navigate("/workspace/rewards")}
                className={`${buttonClass} bg-[#F93920] text-white hover:bg-[#ea311a]`}
              >
                <Gift size={12} />
                {t("budget.banner.earnCredits")}
              </button>
              <button
                type="button"
                onClick={() => navigate("/workspace/models?tab=providers")}
                className={`${buttonClass} border border-border bg-white text-text-secondary hover:bg-surface-1`}
              >
                <Settings2 size={12} />
                {t("budget.banner.byok")}
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
