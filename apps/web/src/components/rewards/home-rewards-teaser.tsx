import { useDesktopRewardsStatus } from "@/hooks/use-desktop-rewards";
import { ArrowUpRight, Gift } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function formatRewardAmount(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function HomeRewardsTeaser() {
  const { t } = useTranslation();
  const { status } = useDesktopRewardsStatus();
  const isCloudConnected = status.viewer.cloudConnected;

  return (
    <Link
      to="/workspace/rewards"
      className="group block overflow-hidden rounded-[24px] border border-[#d9d0be] bg-[linear-gradient(135deg,#fff7e8_0%,#f5efe3_52%,#efe5d5_100%)] shadow-[0_14px_40px_rgba(38,24,8,0.08)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(38,24,8,0.12)]"
    >
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 rounded-full border border-black/8 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-secondary">
            <Gift size={12} className="text-[#a65a1b]" />
            {t("home.rewardsTeaser.eyebrow")}
          </div>
          <h3
            className="mt-3 text-[24px] leading-[1.02] tracking-tight text-[#1f1810]"
            style={{ fontFamily: "Georgia, Times New Roman, serif" }}
          >
            {isCloudConnected
              ? t("home.rewardsTeaser.title")
              : t("budget.viral.loginFirst")}
          </h3>
          <p className="mt-2 max-w-[560px] text-[13px] leading-[1.75] text-[#5f5143]">
            {isCloudConnected
              ? t("home.rewardsTeaser.description")
              : t("budget.viral.desc")}
          </p>
        </div>

        {isCloudConnected ? (
          <div className="shrink-0">
            <div className="rounded-[20px] border border-white/70 bg-white/72 px-4 py-3 text-right shadow-[0_8px_24px_rgba(38,24,8,0.06)]">
              <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                {t("home.rewardsTeaser.summaryLabel")}
              </div>
              <div className="mt-1 text-[26px] font-semibold tracking-tight text-[#1f1810]">
                {status.progress.claimedCount}/{status.progress.totalCount}
              </div>
              <div className="text-[12px] text-[#6d5d4b]">
                {t("home.rewardsTeaser.summaryValue", {
                  earned: formatRewardAmount(status.progress.earnedCredits),
                })}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-t border-black/6 bg-white/38 px-5 py-3 text-[12px] text-text-secondary">
        <span>{t("home.rewardsTeaser.footer")}</span>
        <span className="inline-flex items-center gap-1 font-medium text-[#a65a1b] transition-transform group-hover:translate-x-0.5">
          {t("home.rewardsTeaser.cta")}
          <ArrowUpRight size={13} />
        </span>
      </div>
    </Link>
  );
}
