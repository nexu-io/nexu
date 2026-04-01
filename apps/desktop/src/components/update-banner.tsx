import type { UpdatePhase } from "../hooks/use-auto-update";
import { resolveLocale } from "../lib/i18n";

interface UpdateBannerProps {
  phase: UpdatePhase;
  version: string | null;
  percent: number;
  errorMessage: string | null;
  dismissed: boolean;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}

const i18n = {
  en: {
    badge: "Update",
    checking: "Checking for updates...",
    upToDate: "You're up to date",
    downloading: "Downloading update\u2026",
    installing: "Preparing to install and restart…",
    available: (version: string) => `v${version} available`,
    ready: (version: string) => `v${version} ready`,
    error: "Update failed",
    checkingDetail:
      "Contacting the update feed and comparing the latest release...",
    upToDateDetail: "This channel is already on the latest available version.",
    download: "Download",
    restart: "Restart",
    later: "Later",
    dismiss: "Dismiss",
    unknownError: "Unknown error",
    closeLabel: "Close",
  },
  zh: {
    badge: "更新",
    checking: "正在检查更新...",
    upToDate: "已是最新版本",
    downloading: "正在下载更新\u2026",
    installing: "正在准备安装并重启…",
    available: (version: string) => `v${version} 可更新`,
    ready: (version: string) => `v${version} 已就绪`,
    error: "更新失败",
    checkingDetail: "正在联系更新服务器并对比最新版本...",
    upToDateDetail: "当前频道已是最新可用版本。",
    download: "下载",
    restart: "重启安装",
    later: "稍后",
    dismiss: "关闭",
    unknownError: "未知错误",
    closeLabel: "关闭",
  },
};

/**
 * Small pill badge shown in the brand area when the update banner is dismissed.
 * Clicking it re-opens the full banner.
 */
export function UpdateBadge({
  phase,
  dismissed,
  onUndismiss,
}: {
  phase: UpdatePhase;
  dismissed: boolean;
  onUndismiss: () => void;
}) {
  const t = resolveLocale(i18n);
  const hasUpdate =
    phase === "available" ||
    phase === "downloading" ||
    phase === "installing" ||
    phase === "ready";
  if (!hasUpdate || !dismissed) return null;

  return (
    <button className="update-badge" onClick={onUndismiss} type="button">
      {t.badge}
    </button>
  );
}

/**
 * Sidebar-embedded update card — 1:1 replica of the design-system prototype.
 * Light frosted-glass card that floats inside the dark sidebar.
 */
export function UpdateBanner({
  phase,
  version,
  percent,
  errorMessage,
  dismissed,
  onDownload,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  if (phase === "idle" || dismissed) {
    return null;
  }

  const t = resolveLocale(i18n);
  const isChecking = phase === "checking";
  const isUpToDate = phase === "up-to-date";
  const isDownloading = phase === "downloading";
  const isInstalling = phase === "installing";
  const isReady = phase === "ready";
  const isError = phase === "error";
  const isAvailable = phase === "available";

  return (
    <div className={`update-card${isError ? " update-card--error" : ""}`}>
      {/* Header row: status dot + title | close button */}
      <div className="update-card-header">
        <div className="update-card-status">
          <span
            className={`update-dot-wrapper${isError ? " update-dot--error" : ""}`}
          >
            <span className="update-dot-ping" />
            <span className="update-dot" />
          </span>
          <span className="update-card-title">
            {isChecking && t.checking}
            {isUpToDate && t.upToDate}
            {isDownloading && t.downloading}
            {isInstalling && t.installing}
            {isAvailable && version && t.available(version)}
            {isReady && version && t.ready(version)}
            {isError && t.error}
          </span>
        </div>
        {!isDownloading && !isInstalling && !isChecking && (
          <button
            className="update-card-close"
            onClick={onDismiss}
            type="button"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              role="img"
              aria-label={t.closeLabel}
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>

      {(isChecking || isUpToDate || isInstalling) && (
        <div className="update-card-message">
          {isChecking
            ? t.checkingDetail
            : isInstalling
              ? t.installing
              : t.upToDateDetail}
        </div>
      )}

      {/* Downloading — percentage + progress bar */}
      {(isDownloading || isInstalling) && (
        <>
          <div className="update-card-percent">
            <span>{isInstalling ? "…" : `${Math.round(percent)}%`}</span>
          </div>
          <div className="update-card-progress-wrap">
            <div className="update-card-progress-track">
              <div
                className="update-card-progress-fill"
                style={{ width: isInstalling ? "100%" : `${percent}%` }}
              />
            </div>
          </div>
        </>
      )}

      {/* Available — Download / Later */}
      {isAvailable && (
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--primary"
            onClick={onDownload}
            type="button"
          >
            {t.download}
          </button>
          <button
            className="update-card-btn update-card-btn--ghost"
            onClick={onDismiss}
            type="button"
          >
            {t.later}
          </button>
        </div>
      )}

      {/* Ready — Restart / Later */}
      {isReady && (
        <div className="update-card-actions">
          <button
            className="update-card-btn update-card-btn--primary"
            onClick={onInstall}
            type="button"
          >
            {t.restart}
          </button>
          <button
            className="update-card-btn update-card-btn--ghost"
            onClick={onDismiss}
            type="button"
          >
            {t.later}
          </button>
        </div>
      )}

      {/* Error — message + Dismiss */}
      {isError && (
        <>
          <div className="update-card-error-msg">
            {errorMessage ?? t.unknownError}
          </div>
          <div className="update-card-actions">
            <button
              className="update-card-btn update-card-btn--ghost"
              onClick={onDismiss}
              type="button"
            >
              {t.dismiss}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
